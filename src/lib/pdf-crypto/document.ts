import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFContext,
} from "pdf-lib";
import {
  aesCbcDecryptLenient,
  aesCbcEncrypt,
  concat,
  randomBytes,
  rc4,
} from "./primitives";
import {
  createEncryption,
  deriveFileKey,
  encodePassword,
  objectKey,
  PERMIT_ALL,
  type CipherMethod,
  type EncryptionInfo,
} from "./standard-handler";

export class PdfPasswordError extends Error {
  constructor(
    message: string,
    readonly code: "wrong-password" | "unsupported" | "not-encrypted" | "failed"
  ) {
    super(message);
    this.name = "PdfPasswordError";
  }
}

function bytesOfString(value: PDFObject | undefined): Uint8Array | undefined {
  if (value instanceof PDFHexString) {
    const hex = value.asBytes();
    return hex;
  }
  if (value instanceof PDFString) return value.asBytes();
  return undefined;
}

function methodFromName(name: string | undefined): CipherMethod {
  switch (name) {
    case "AESV2":
      return "aesv2";
    case "AESV3":
      return "aesv3";
    case "V2":
    case "RC4":
      return "rc4";
    case "None":
      return "none";
    default:
      return "rc4";
  }
}

/** Read the /Encrypt dictionary into something the handler can work with. */
export function readEncryption(context: PDFContext): EncryptionInfo | null {
  const raw = context.trailerInfo.Encrypt;
  if (!raw) return null;
  const dict = raw instanceof PDFRef ? context.lookup(raw, PDFDict) : (raw as PDFDict);
  if (!(dict instanceof PDFDict)) return null;

  const filter = dict.lookup(PDFName.of("Filter"));
  if (filter instanceof PDFName && filter.asString() !== "/Standard") {
    throw new PdfPasswordError(
      "This PDF uses a security handler this tool does not support.",
      "unsupported"
    );
  }

  const version = (dict.lookup(PDFName.of("V")) as PDFNumber | undefined)?.asNumber() ?? 0;
  const revision = (dict.lookup(PDFName.of("R")) as PDFNumber | undefined)?.asNumber() ?? 2;
  const lengthBits = (dict.lookup(PDFName.of("Length")) as PDFNumber | undefined)?.asNumber() ?? 40;
  const permissions = (dict.lookup(PDFName.of("P")) as PDFNumber | undefined)?.asNumber() ?? -1;
  const encryptMetadata =
    (dict.lookup(PDFName.of("EncryptMetadata")) as { asBoolean?: () => boolean } | undefined)
      ?.asBoolean?.() ?? true;

  const o = bytesOfString(dict.lookup(PDFName.of("O")));
  const u = bytesOfString(dict.lookup(PDFName.of("U")));
  if (!o || !u) {
    throw new PdfPasswordError("This PDF's encryption data is incomplete.", "failed");
  }

  let streamMethod: CipherMethod = "rc4";
  let stringMethod: CipherMethod = "rc4";
  let keyLength = Math.floor(lengthBits / 8) || 5;

  if (version >= 4) {
    const cf = dict.lookup(PDFName.of("CF"), PDFDict);
    const stmF = dict.lookup(PDFName.of("StmF")) as PDFName | undefined;
    const strF = dict.lookup(PDFName.of("StrF")) as PDFName | undefined;
    const resolve = (nameRef: PDFName | undefined): CipherMethod => {
      const key = nameRef?.asString().replace(/^\//, "") ?? "Identity";
      if (key === "Identity") return "none";
      const entry = cf?.lookup(PDFName.of(key), PDFDict);
      const cfm = entry?.lookup(PDFName.of("CFM")) as PDFName | undefined;
      const entryLength = (entry?.lookup(PDFName.of("Length")) as PDFNumber | undefined)?.asNumber();
      if (entryLength) {
        // /Length here is in bytes for crypt filters, but files disagree.
        keyLength = entryLength > 40 ? Math.floor(entryLength / 8) : entryLength;
      }
      return methodFromName(cfm?.asString().replace(/^\//, ""));
    };
    streamMethod = resolve(stmF);
    stringMethod = resolve(strF);
  }
  if (revision >= 5) {
    streamMethod = "aesv3";
    stringMethod = "aesv3";
    keyLength = 32;
  }

  const idArray = context.trailerInfo.ID as PDFArray | undefined;
  const idFirst = idArray ? (bytesOfString(idArray.get(0)) ?? new Uint8Array(0)) : new Uint8Array(0);

  return {
    revision,
    version,
    keyLength,
    permissions,
    o,
    u,
    oe: bytesOfString(dict.lookup(PDFName.of("OE"))),
    ue: bytesOfString(dict.lookup(PDFName.of("UE"))),
    encryptMetadata,
    streamMethod,
    stringMethod,
    idFirst,
  };
}

type Transform = (
  data: Uint8Array,
  objectNumber: number,
  generation: number,
  method: CipherMethod
) => Promise<Uint8Array>;

/**
 * Walk every indirect object, applying `transform` to each string and stream.
 *
 * The /Encrypt dictionary is skipped — its own strings are never encrypted —
 * and so is the document ID in the trailer.
 */
async function transformObjects(
  context: PDFContext,
  info: { streamMethod: CipherMethod; stringMethod: CipherMethod },
  encryptRef: PDFRef | null,
  transform: Transform
): Promise<void> {
  const visitString = async (
    value: PDFObject,
    objectNumber: number,
    generation: number
  ): Promise<PDFObject> => {
    if (info.stringMethod === "none") return value;
    if (value instanceof PDFString || value instanceof PDFHexString) {
      const out = await transform(value.asBytes(), objectNumber, generation, info.stringMethod);
      return PDFHexString.of(
        Array.from(out, (b) => b.toString(16).padStart(2, "0")).join("")
      );
    }
    return value;
  };

  const walk = async (
    value: PDFObject,
    objectNumber: number,
    generation: number
  ): Promise<PDFObject> => {
    if (value instanceof PDFArray) {
      for (let i = 0; i < value.size(); i++) {
        const child = value.get(i);
        if (child instanceof PDFRef) continue;
        value.set(i, await walk(child, objectNumber, generation));
      }
      return value;
    }
    if (value instanceof PDFDict) {
      for (const [key, child] of value.entries()) {
        if (child instanceof PDFRef) continue;
        value.set(key, await walk(child, objectNumber, generation));
      }
      return value;
    }
    return visitString(value, objectNumber, generation);
  };

  // Streams are immutable in pdf-lib, so replacements are collected and
  // assigned once the walk is finished.
  const replacements: Array<[PDFRef, PDFRawStream]> = [];

  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (encryptRef && ref.objectNumber === encryptRef.objectNumber) continue;

    if (object instanceof PDFStream) {
      const dict = object.dict;
      for (const [key, child] of dict.entries()) {
        if (child instanceof PDFRef) continue;
        dict.set(key, await walk(child, ref.objectNumber, ref.generationNumber));
      }
      if (object instanceof PDFRawStream && info.streamMethod !== "none") {
        const contents = await transform(
          object.contents,
          ref.objectNumber,
          ref.generationNumber,
          info.streamMethod
        );
        dict.set(PDFName.of("Length"), PDFNumber.of(contents.length));
        replacements.push([ref, PDFRawStream.of(dict, contents)]);
      }
      continue;
    }

    await walk(object, ref.objectNumber, ref.generationNumber);
  }

  for (const [ref, stream] of replacements) context.assign(ref, stream);
}

async function decryptBytes(
  fileKey: Uint8Array,
  data: Uint8Array,
  objectNumber: number,
  generation: number,
  method: CipherMethod
): Promise<Uint8Array> {
  if (method === "none" || data.length === 0) return data;
  const key = objectKey(fileKey, objectNumber, generation, method);
  if (method === "rc4") return rc4(key, data);
  if (data.length <= 16) return new Uint8Array(0);
  return aesCbcDecryptLenient(key, data.subarray(0, 16), data.subarray(16));
}

async function encryptBytes(
  fileKey: Uint8Array,
  data: Uint8Array,
  objectNumber: number,
  generation: number,
  method: CipherMethod
): Promise<Uint8Array> {
  if (method === "none") return data;
  const key = objectKey(fileKey, objectNumber, generation, method);
  if (method === "rc4") return rc4(key, data);
  const iv = randomBytes(16);
  return concat(iv, await aesCbcEncrypt(key, iv, data));
}

/**
 * Remove a PDF's password.
 *
 * The document is parsed without decryption, every string and stream is
 * decrypted in place with the key the password yields, and the /Encrypt entry
 * is dropped so the result opens freely.
 */
export async function removePassword(
  bytes: Uint8Array,
  password: string
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const context = doc.context;
  const info = readEncryption(context);
  if (!info) {
    throw new PdfPasswordError("This PDF is not password-protected.", "not-encrypted");
  }
  if (info.revision > 6) {
    throw new PdfPasswordError(
      "This PDF uses an encryption revision this tool does not support.",
      "unsupported"
    );
  }

  const attempts = [password, ""];
  let fileKey: Uint8Array | null = null;
  for (const attempt of attempts) {
    const result = await deriveFileKey(encodePassword(attempt), info);
    if (result.ok) {
      fileKey = result.key;
      break;
    }
  }
  if (!fileKey) {
    throw new PdfPasswordError(
      "That password does not open this PDF. Check it and try again.",
      "wrong-password"
    );
  }

  const encryptRaw = context.trailerInfo.Encrypt;
  const encryptRef = encryptRaw instanceof PDFRef ? encryptRaw : null;

  await transformObjects(context, info, encryptRef, (data, objectNumber, generation, method) =>
    decryptBytes(fileKey as Uint8Array, data, objectNumber, generation, method)
  );

  delete context.trailerInfo.Encrypt;
  if (encryptRef) context.delete(encryptRef);

  // Object streams must stay off: the parser read them while they were
  // encrypted, and re-packing would change object numbering.
  return doc.save({ useObjectStreams: false });
}

export type ProtectOptions = {
  userPassword: string;
  /** Defaults to the user password when omitted. */
  ownerPassword?: string;
};

/**
 * Add AES-256 password protection.
 *
 * The document is re-saved first so pdf-lib produces a clean, object-stream
 * free file, then every string and stream in it is encrypted and an /Encrypt
 * dictionary is attached.
 */
export async function addPassword(
  bytes: Uint8Array,
  options: ProtectOptions
): Promise<Uint8Array> {
  const probe = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  if (readEncryption(probe.context)) {
    throw new PdfPasswordError(
      "This PDF is already password-protected. Unlock it first, then set a new password.",
      "failed"
    );
  }

  // Round-trip through pdf-lib so the file has no object streams — every
  // string and stream has to be individually addressable to be encrypted.
  const flat = await probe.save({ useObjectStreams: false });
  const doc = await PDFDocument.load(flat, { updateMetadata: false });
  const context = doc.context;

  const encryption = await createEncryption(
    options.userPassword,
    options.ownerPassword?.trim() || options.userPassword,
    PERMIT_ALL
  );

  // A file ID is required alongside encryption; keep the existing one if there
  // is one, otherwise mint a pair.
  if (!context.trailerInfo.ID) {
    const id = PDFHexString.of(
      Array.from(randomBytes(16), (b) => b.toString(16).padStart(2, "0")).join("")
    );
    context.trailerInfo.ID = context.obj([id, id]);
  }

  const info = { streamMethod: "aesv3" as CipherMethod, stringMethod: "aesv3" as CipherMethod };
  await transformObjects(context, info, null, (data, objectNumber, generation, method) =>
    encryptBytes(encryption.fileKey, data, objectNumber, generation, method)
  );

  const hex = (value: Uint8Array) =>
    PDFHexString.of(Array.from(value, (b) => b.toString(16).padStart(2, "0")).join(""));

  const cryptFilter = context.obj({
    CFM: PDFName.of("AESV3"),
    AuthEvent: PDFName.of("DocOpen"),
    Length: PDFNumber.of(32),
  });
  const encryptDict = context.obj({
    Filter: PDFName.of("Standard"),
    V: PDFNumber.of(5),
    R: PDFNumber.of(6),
    Length: PDFNumber.of(256),
    CF: context.obj({ StdCF: cryptFilter }),
    StmF: PDFName.of("StdCF"),
    StrF: PDFName.of("StdCF"),
    P: PDFNumber.of(encryption.permissions),
    EncryptMetadata: true,
    O: hex(encryption.o),
    U: hex(encryption.u),
    OE: hex(encryption.oe),
    UE: hex(encryption.ue),
    Perms: hex(encryption.perms),
  });

  context.trailerInfo.Encrypt = context.register(encryptDict);
  return doc.save({ useObjectStreams: false });
}
