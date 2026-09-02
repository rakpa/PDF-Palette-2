/**
 * The primitives the PDF standard security handler needs that the platform
 * does not provide: MD5 and RC4 (used by the older revisions, 2 to 4) plus
 * thin wrappers over Web Crypto for the AES modes PDF uses.
 *
 * MD5 and RC4 are here because PDFs written before 2008 use them, not because
 * they are worth using — anything this app *writes* is AES-256.
 */

/* ------------------------------------------------------------------ MD5 -- */

const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const MD5_K = new Uint32Array(
  Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32))
);

function rotateLeft(value: number, shift: number): number {
  return (value << shift) | (value >>> (32 - shift));
}

export function md5(input: Uint8Array): Uint8Array {
  const length = input.length;
  const withPadding = new Uint8Array((((length + 8) >> 6) + 1) << 6);
  withPadding.set(input);
  withPadding[length] = 0x80;
  const bitLength = length * 8;
  const view = new DataView(withPadding.buffer);
  view.setUint32(withPadding.length - 8, bitLength >>> 0, true);
  view.setUint32(withPadding.length - 4, Math.floor(bitLength / 2 ** 32), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const chunk = new Uint32Array(16);
  for (let offset = 0; offset < withPadding.length; offset += 64) {
    for (let i = 0; i < 16; i++) chunk[i] = view.getUint32(offset + i * 4, true);

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const temp = d;
      d = c;
      c = b;
      b = (b + rotateLeft((a + f + MD5_K[i] + chunk[g]) >>> 0, MD5_S[i])) >>> 0;
      a = temp;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, a0, true);
  outView.setUint32(4, b0, true);
  outView.setUint32(8, c0, true);
  outView.setUint32(12, d0, true);
  return out;
}

/* ------------------------------------------------------------------ RC4 -- */

export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = new Uint8Array(data.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 0xff];
  }
  return out;
}

/* ------------------------------------------------------------------ AES -- */

function subtle(): SubtleCrypto {
  const value = globalThis.crypto?.subtle;
  if (!value) {
    throw new Error("This browser does not expose Web Crypto, which PDF passwords need.");
  }
  return value;
}

async function importAesKey(key: Uint8Array): Promise<CryptoKey> {
  return subtle().importKey("raw", key as unknown as BufferSource, { name: "AES-CBC" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * AES-CBC without padding.
 *
 * Web Crypto always applies PKCS#7, which appends exactly one extra block for
 * input that is already a whole number of blocks. Because CBC is sequential,
 * dropping that trailing block leaves precisely the unpadded result.
 */
export async function aesCbcEncryptNoPad(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array
): Promise<Uint8Array> {
  if (data.length % 16 !== 0) throw new Error("AES input must be a multiple of the block size.");
  const cipher = new Uint8Array(
    await subtle().encrypt(
      { name: "AES-CBC", iv: iv as unknown as BufferSource },
      await importAesKey(key),
      data as unknown as BufferSource
    )
  );
  return cipher.subarray(0, data.length);
}

/** AES-CBC with the PKCS#7 padding PDF's AESV2/AESV3 filters use. */
export async function aesCbcEncrypt(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array
): Promise<Uint8Array> {
  return new Uint8Array(
    await subtle().encrypt(
      { name: "AES-CBC", iv: iv as unknown as BufferSource },
      await importAesKey(key),
      data as unknown as BufferSource
    )
  );
}

export async function aesCbcDecrypt(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array
): Promise<Uint8Array> {
  return new Uint8Array(
    await subtle().decrypt(
      { name: "AES-CBC", iv: iv as unknown as BufferSource },
      await importAesKey(key),
      data as unknown as BufferSource
    )
  );
}

/**
 * Decrypt CBC data whose padding cannot be trusted.
 *
 * Web Crypto rejects a bad PKCS#7 tail outright, but PDFs in the wild are not
 * always padded correctly, and a stream that fails to unpad is still worth
 * recovering. Falling back to a manual last-block decrypt keeps those files
 * readable.
 */
export async function aesCbcDecryptLenient(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array
): Promise<Uint8Array> {
  if (data.length === 0) return data;
  try {
    return await aesCbcDecrypt(key, iv, data);
  } catch {
    if (data.length < 16 || data.length % 16 !== 0) return new Uint8Array(0);
    // Re-encrypting a synthetic final block lets the same call decrypt every
    // real block, after which the trailing padding is simply dropped.
    const head = data.subarray(0, data.length - 16);
    const tailIv = data.length >= 32 ? data.subarray(data.length - 32, data.length - 16) : iv;
    const padded = await aesCbcEncrypt(key, tailIv, new Uint8Array(0));
    const combined = new Uint8Array(data.length + padded.length - 16);
    combined.set(data.subarray(0, data.length), 0);
    combined.set(padded, data.length);
    try {
      const all = await aesCbcDecrypt(key, iv, combined.subarray(0, data.length + 16));
      return all.subarray(0, head.length + 16);
    } catch {
      return new Uint8Array(0);
    }
  }
}

/** A single AES block in ECB mode — CBC with a zero IV over one block. */
export async function aesEcbEncryptBlock(
  key: Uint8Array,
  block: Uint8Array
): Promise<Uint8Array> {
  return aesCbcEncryptNoPad(key, new Uint8Array(16), block);
}

/* --------------------------------------------------------------- misc --- */

export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest("SHA-256", data as unknown as BufferSource));
}

export async function sha384(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest("SHA-384", data as unknown as BufferSource));
}

export async function sha512(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest("SHA-512", data as unknown as BufferSource));
}
