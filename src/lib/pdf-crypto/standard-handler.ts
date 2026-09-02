import {
  aesCbcDecrypt,
  aesCbcEncryptNoPad,
  bytesEqual,
  concat,
  md5,
  randomBytes,
  rc4,
  sha256,
  sha384,
  sha512,
} from "./primitives";

/**
 * The PDF standard security handler (ISO 32000, §7.6.3).
 *
 * Revisions 2 to 4 derive their key with MD5 and RC4 and are only implemented
 * so existing files can be opened. Revision 6 (AES-256) is what this app
 * writes.
 */

/** The 32-byte padding string every revision up to 4 pads passwords with. */
const PAD = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

export type CipherMethod = "rc4" | "aesv2" | "aesv3" | "none";

export type EncryptionInfo = {
  revision: number;
  version: number;
  /** Key length in bytes. */
  keyLength: number;
  permissions: number;
  o: Uint8Array;
  u: Uint8Array;
  oe?: Uint8Array;
  ue?: Uint8Array;
  encryptMetadata: boolean;
  streamMethod: CipherMethod;
  stringMethod: CipherMethod;
  idFirst: Uint8Array;
};

function padPassword(password: Uint8Array): Uint8Array {
  const out = new Uint8Array(32);
  const take = Math.min(password.length, 32);
  out.set(password.subarray(0, take));
  out.set(PAD.subarray(0, 32 - take), take);
  return out;
}

function int32le(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setInt32(0, value | 0, true);
  return out;
}

/** Revisions 2–4: derive the file key from the user password (Algorithm 2). */
function legacyFileKey(password: Uint8Array, info: EncryptionInfo): Uint8Array {
  const parts = [
    padPassword(password),
    info.o.subarray(0, 32),
    int32le(info.permissions),
    info.idFirst,
  ];
  if (info.revision >= 4 && !info.encryptMetadata) {
    parts.push(new Uint8Array([0xff, 0xff, 0xff, 0xff]));
  }
  let key = md5(concat(...parts));
  if (info.revision >= 3) {
    for (let i = 0; i < 50; i++) key = md5(key.subarray(0, info.keyLength));
  }
  return key.subarray(0, info.revision === 2 ? 5 : info.keyLength);
}

/** Revisions 2–4: the /U value the given key should produce. */
function legacyUserValue(key: Uint8Array, info: EncryptionInfo): Uint8Array {
  if (info.revision === 2) return rc4(key, PAD);
  const seed = md5(concat(PAD, info.idFirst));
  let value = rc4(key, seed);
  for (let i = 1; i <= 19; i++) {
    const round = new Uint8Array(key.length);
    for (let j = 0; j < key.length; j++) round[j] = key[j] ^ i;
    value = rc4(round, value);
  }
  return value;
}

/** Revisions 2–4: recover the user password hidden in /O (Algorithm 7). */
function legacyOwnerToUser(ownerPassword: Uint8Array, info: EncryptionInfo): Uint8Array {
  let key = md5(padPassword(ownerPassword));
  if (info.revision >= 3) {
    for (let i = 0; i < 50; i++) key = md5(key);
  }
  const rc4Key = key.subarray(0, info.revision === 2 ? 5 : info.keyLength);
  if (info.revision === 2) return rc4(rc4Key, info.o.subarray(0, 32));

  let value = info.o.subarray(0, 32);
  for (let i = 19; i >= 0; i--) {
    const round = new Uint8Array(rc4Key.length);
    for (let j = 0; j < rc4Key.length; j++) round[j] = rc4Key[j] ^ i;
    value = rc4(round, value);
  }
  return value;
}

/**
 * Revision 6 "hardened" hash (Algorithm 2.B). Sixty-four rounds minimum of
 * AES-CBC over the password, then more until the last byte of the round's
 * output falls below the round count.
 */
async function hash2B(
  password: Uint8Array,
  salt: Uint8Array,
  userData: Uint8Array
): Promise<Uint8Array> {
  let k = await sha256(concat(password, salt, userData));
  for (let round = 0; ; round++) {
    const block = concat(password, k, userData);
    const k1 = new Uint8Array(block.length * 64);
    for (let i = 0; i < 64; i++) k1.set(block, i * block.length);

    const e = await aesCbcEncryptNoPad(k.subarray(0, 16), k.subarray(16, 32), k1);

    let sum = 0;
    for (let i = 0; i < 16; i++) sum += e[i];
    const mod = sum % 3;
    k = mod === 0 ? await sha256(e) : mod === 1 ? await sha384(e) : await sha512(e);

    if (round >= 63 && e[e.length - 1] <= round - 31) break;
  }
  return k.subarray(0, 32);
}

async function revision6Hash(
  password: Uint8Array,
  salt: Uint8Array,
  userData: Uint8Array,
  revision: number
): Promise<Uint8Array> {
  // Revision 5 was Adobe's pre-standard draft and uses a plain SHA-256.
  if (revision === 5) return sha256(concat(password, salt, userData));
  return hash2B(password, salt, userData);
}

export type UnlockResult =
  | { ok: true; key: Uint8Array; usedOwnerPassword: boolean }
  | { ok: false };

/** Work out the file encryption key from a password, or report a mismatch. */
export async function deriveFileKey(
  password: Uint8Array,
  info: EncryptionInfo
): Promise<UnlockResult> {
  if (info.revision >= 5) {
    const u48 = info.u.subarray(0, 48);

    const userHash = await revision6Hash(
      password,
      info.u.subarray(32, 40),
      new Uint8Array(0),
      info.revision
    );
    if (bytesEqual(userHash, info.u.subarray(0, 32)) && info.ue) {
      const intermediate = await revision6Hash(
        password,
        info.u.subarray(40, 48),
        new Uint8Array(0),
        info.revision
      );
      return { ok: true, key: await decryptNoPad(intermediate, info.ue), usedOwnerPassword: false };
    }

    const ownerHash = await revision6Hash(password, info.o.subarray(32, 40), u48, info.revision);
    if (bytesEqual(ownerHash, info.o.subarray(0, 32)) && info.oe) {
      const intermediate = await revision6Hash(
        password,
        info.o.subarray(40, 48),
        u48,
        info.revision
      );
      return {
        ok: true,
        key: await decryptNoPad(intermediate, info.oe),
        usedOwnerPassword: true,
      };
    }
    return { ok: false };
  }

  const asUser = legacyFileKey(password, info);
  const expected = legacyUserValue(asUser, info);
  const compareLength = info.revision === 2 ? 32 : 16;
  if (bytesEqual(expected.subarray(0, compareLength), info.u.subarray(0, compareLength))) {
    return { ok: true, key: asUser, usedOwnerPassword: false };
  }

  // Not the user password — try it as the owner password.
  const recovered = legacyOwnerToUser(password, info);
  const asOwner = legacyFileKey(recovered, info);
  const ownerExpected = legacyUserValue(asOwner, info);
  if (bytesEqual(ownerExpected.subarray(0, compareLength), info.u.subarray(0, compareLength))) {
    return { ok: true, key: asOwner, usedOwnerPassword: true };
  }

  return { ok: false };
}

/** AES-256-CBC with a zero IV and no padding, as the UE/OE entries use. */
async function decryptNoPad(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  // Appending a block that decrypts to valid padding lets Web Crypto accept it.
  const padded = await aesCbcEncryptNoPad(key, data.subarray(data.length - 16), pkcs7Block());
  const full = concat(data, padded);
  const plain = await aesCbcDecrypt(key, new Uint8Array(16), full);
  return plain.subarray(0, data.length);
}

function pkcs7Block(): Uint8Array {
  return new Uint8Array(16).fill(16);
}

/** The per-object key revisions 2–4 use; revisions 5+ use the file key as-is. */
export function objectKey(
  fileKey: Uint8Array,
  objectNumber: number,
  generation: number,
  method: CipherMethod
): Uint8Array {
  if (method === "aesv3") return fileKey;
  const extra = method === "aesv2" ? new Uint8Array([0x73, 0x41, 0x6c, 0x54]) : new Uint8Array(0);
  const digest = md5(
    concat(
      fileKey,
      new Uint8Array([
        objectNumber & 0xff,
        (objectNumber >> 8) & 0xff,
        (objectNumber >> 16) & 0xff,
        generation & 0xff,
        (generation >> 8) & 0xff,
      ]),
      extra
    )
  );
  return digest.subarray(0, Math.min(fileKey.length + 5, 16));
}

/** Everything needed to write a fresh AES-256 (revision 6) /Encrypt dict. */
export type NewEncryption = {
  fileKey: Uint8Array;
  o: Uint8Array;
  u: Uint8Array;
  oe: Uint8Array;
  ue: Uint8Array;
  perms: Uint8Array;
  permissions: number;
};

/**
 * Revision 6 passwords are UTF-8, capped at 127 bytes. The specification also
 * asks for SASLprep normalisation; NFKC covers the cases that matter here
 * (compatibility forms and width variants) without pulling in a stringprep
 * table.
 */
export function encodePassword(password: string): Uint8Array {
  const normalized = password.normalize ? password.normalize("NFKC") : password;
  return new TextEncoder().encode(normalized).subarray(0, 127);
}

export async function createEncryption(
  userPassword: string,
  ownerPassword: string,
  permissions: number
): Promise<NewEncryption> {
  const fileKey = randomBytes(32);
  const user = encodePassword(userPassword);
  const owner = encodePassword(ownerPassword);

  const uValidationSalt = randomBytes(8);
  const uKeySalt = randomBytes(8);
  const uHash = await hash2B(user, uValidationSalt, new Uint8Array(0));
  const u = concat(uHash, uValidationSalt, uKeySalt);
  const ue = await aesCbcEncryptNoPad(
    await hash2B(user, uKeySalt, new Uint8Array(0)),
    new Uint8Array(16),
    fileKey
  );

  const oValidationSalt = randomBytes(8);
  const oKeySalt = randomBytes(8);
  const oHash = await hash2B(owner, oValidationSalt, u);
  const o = concat(oHash, oValidationSalt, oKeySalt);
  const oe = await aesCbcEncryptNoPad(
    await hash2B(owner, oKeySalt, u),
    new Uint8Array(16),
    fileKey
  );

  // /Perms: the permission bits, sealed with the file key so a viewer can tell
  // they have not been tampered with.
  const permsPlain = concat(
    int32le(permissions),
    new Uint8Array([0xff, 0xff, 0xff, 0xff]),
    new Uint8Array([0x54]), // 'T' — metadata is encrypted
    new Uint8Array([0x61, 0x64, 0x62]), // 'adb'
    randomBytes(4)
  );
  const perms = await aesCbcEncryptNoPad(fileKey, new Uint8Array(16), permsPlain);

  return { fileKey, o, u, oe, ue, perms, permissions };
}

/** Permission bits: everything allowed. Bits 1–2 are reserved and set. */
export const PERMIT_ALL = -1;
