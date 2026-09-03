/**
 * Minimal ZIP writer.
 *
 * Enough of the format to hand back a folder of files — page images, split
 * documents — as one download. Deflate comes from the browser's own
 * CompressionStream; an entry that does not get smaller is stored as-is.
 */

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const EOCD = 0x06054b50;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  const stream = new Blob([data as unknown as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

interface StagedEntry {
  name: Uint8Array;
  data: Uint8Array;
  crc: number;
  rawSize: number;
  method: number;
  offset: number;
}

/** DOS date/time, which is all a ZIP central directory records. */
function dosStamp(date: Date): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export async function createZip(entries: ZipEntry[]): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const stamp = dosStamp(new Date());
  const staged: StagedEntry[] = [];
  const chunks: Uint8Array[] = [];
  let offset = 0;

  const push = (bytes: Uint8Array) => {
    chunks.push(bytes);
    offset += bytes.length;
  };

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const deflated = await deflateRaw(entry.data);
    const useDeflate = deflated !== null && deflated.length < entry.data.length;
    const payload = useDeflate ? deflated! : entry.data;

    const staging: StagedEntry = {
      name,
      data: payload,
      crc: crc32(entry.data),
      rawSize: entry.data.length,
      method: useDeflate ? 8 : 0,
      offset,
    };
    staged.push(staging);

    const header = new Uint8Array(30 + name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, LOCAL, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 1 << 11, true); // UTF-8 names
    view.setUint16(8, staging.method, true);
    view.setUint16(10, stamp.time, true);
    view.setUint16(12, stamp.date, true);
    view.setUint32(14, staging.crc, true);
    view.setUint32(18, payload.length, true);
    view.setUint32(22, staging.rawSize, true);
    view.setUint16(26, name.length, true);
    header.set(name, 30);
    push(header);
    push(payload);
  }

  const directoryStart = offset;
  for (const entry of staged) {
    const record = new Uint8Array(46 + entry.name.length);
    const view = new DataView(record.buffer);
    view.setUint32(0, CENTRAL, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 1 << 11, true);
    view.setUint16(10, entry.method, true);
    view.setUint16(12, stamp.time, true);
    view.setUint16(14, stamp.date, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, entry.data.length, true);
    view.setUint32(24, entry.rawSize, true);
    view.setUint16(28, entry.name.length, true);
    view.setUint32(42, entry.offset, true);
    record.set(entry.name, 46);
    push(record);
  }

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, EOCD, true);
  endView.setUint16(8, staged.length, true);
  endView.setUint16(10, staged.length, true);
  endView.setUint32(12, offset - directoryStart, true);
  endView.setUint32(16, directoryStart, true);
  push(end);

  const out = new Uint8Array(offset);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
