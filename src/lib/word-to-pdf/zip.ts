/**
 * Minimal ZIP reader for .docx packages (store + deflate).
 * Word files do not use ZIP64, encryption, or spanning archives.
 */

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const EOCD = 0x06054b50;

function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function findEocd(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const min = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (u32(view, i) === EOCD) return i;
  }
  throw new Error("Not a ZIP archive");
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Deflate is not available in this browser");
  }
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function decodeName(bytes: Uint8Array, utf8: boolean): string {
  if (utf8) return new TextDecoder("utf-8").decode(bytes);
  let out = "";
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

export type ZipFile = {
  read: (path: string) => Promise<Uint8Array | undefined>;
  list: () => string[];
};

export async function openZip(buffer: ArrayBuffer): Promise<ZipFile> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(bytes);
  const count = u16(view, eocd + 10);
  let offset = u32(view, eocd + 16);

  const entries = new Map<
    string,
    { method: number; local: number; compressed: number; uncompressed: number; utf8: boolean }
  >();

  for (let i = 0; i < count; i++) {
    if (u32(view, offset) !== CENTRAL) break;
    const method = u16(view, offset + 10);
    const flags = u16(view, offset + 8);
    const compressed = u32(view, offset + 20);
    const uncompressed = u32(view, offset + 24);
    const nameLen = u16(view, offset + 28);
    const extraLen = u16(view, offset + 30);
    const commentLen = u16(view, offset + 32);
    const local = u32(view, offset + 42);
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameLen);
    const name = decodeName(nameBytes, (flags & 0x800) !== 0).replace(/\\/g, "/");
    entries.set(name, { method, local, compressed, uncompressed, utf8: (flags & 0x800) !== 0 });
    offset += 46 + nameLen + extraLen + commentLen;
  }

  async function read(path: string): Promise<Uint8Array | undefined> {
    const key = path.replace(/^\.\//, "").replace(/\\/g, "/");
    const entry = entries.get(key) ?? entries.get(key.replace(/^word\//, ""));
    if (!entry) return undefined;
    if (u32(view, entry.local) !== LOCAL) return undefined;
    const nameLen = u16(view, entry.local + 26);
    const extraLen = u16(view, entry.local + 28);
    const start = entry.local + 30 + nameLen + extraLen;
    const packed = bytes.subarray(start, start + entry.compressed);
    if (entry.method === 0) return packed.slice();
    if (entry.method === 8) return inflateRaw(packed);
    throw new Error(`Unsupported ZIP compression (${entry.method})`);
  }

  return { read, list: () => [...entries.keys()] };
}

export function decodeUtf8(data: Uint8Array): string {
  return new TextDecoder("utf-8").decode(data);
}
