import { open, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { deflateRaw } from 'node:zlib';

const deflateRawAsync = promisify(deflateRaw);
const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1)
    value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  return value >>> 0;
});

function crc32(value: Buffer) {
  let crc = 0xffffffff;
  for (const byte of value)
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Analytics-only sequential ZIP writer for bounded text entries. */
export class ResearchReportArchive {
  private offset = 0;
  private centralDirectorySize = 0;
  private entryCount = 0;
  private closed = false;
  private readonly filePromise: ReturnType<typeof open>;
  private readonly centralFilePromise: ReturnType<typeof open>;
  private readonly centralPath: string;

  constructor(path: string) {
    this.filePromise = open(path, 'w');
    this.centralPath = `${path}.central-${process.pid}-${Date.now()}`;
    this.centralFilePromise = open(this.centralPath, 'w');
  }

  async addText(name: string, text: string) {
    const file = await this.filePromise;
    const filename = Buffer.from(name);
    const content = Buffer.from(text);
    const compressed = await deflateRawAsync(content);
    const checksum = crc32(content);
    const local = Buffer.alloc(30 + filename.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(filename.length, 26);
    filename.copy(local, 30);

    const requiresZip64Offset = this.offset >= UINT32_MAX;
    const zip64Extra = requiresZip64Offset ? Buffer.alloc(12) : Buffer.alloc(0);
    if (requiresZip64Offset) {
      zip64Extra.writeUInt16LE(0x0001, 0);
      zip64Extra.writeUInt16LE(8, 2);
      zip64Extra.writeBigUInt64LE(BigInt(this.offset), 4);
    }
    const central = Buffer.alloc(46 + filename.length + zip64Extra.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(requiresZip64Offset ? 45 : 20, 4);
    central.writeUInt16LE(requiresZip64Offset ? 45 : 20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt16LE(zip64Extra.length, 30);
    central.writeUInt32LE(requiresZip64Offset ? UINT32_MAX : this.offset, 42);
    filename.copy(central, 46);
    zip64Extra.copy(central, 46 + filename.length);

    await file.write(local);
    await file.write(compressed);
    const centralFile = await this.centralFilePromise;
    await centralFile.write(central);
    this.centralDirectorySize += central.length;
    this.entryCount += 1;
    this.offset += local.length + compressed.length;
  }

  async close() {
    if (this.closed) return;
    const file = await this.filePromise;
    try {
      const centralDirectoryOffset = this.offset;
      await (await this.centralFilePromise).close();
      const centralFile = await open(this.centralPath, 'r');
      try {
        const buffer = Buffer.alloc(64 * 1024);
        let position = 0;
        while (position < this.centralDirectorySize) {
          const { bytesRead } = await centralFile.read(
            buffer,
            0,
            buffer.length,
            position,
          );
          if (bytesRead === 0)
            throw new Error('Unable to read ZIP central directory');
          await file.write(buffer.subarray(0, bytesRead));
          position += bytesRead;
        }
      } finally {
        await centralFile.close();
      }
      const end = Buffer.alloc(22);
      const requiresZip64 =
        this.entryCount > UINT16_MAX ||
        this.centralDirectorySize >= UINT32_MAX ||
        centralDirectoryOffset >= UINT32_MAX;
      if (requiresZip64) {
        const zip64EndOffset =
          centralDirectoryOffset + this.centralDirectorySize;
        const zip64End = Buffer.alloc(56);
        zip64End.writeUInt32LE(0x06064b50, 0);
        zip64End.writeBigUInt64LE(44n, 4);
        zip64End.writeUInt16LE(45, 12);
        zip64End.writeUInt16LE(45, 14);
        zip64End.writeBigUInt64LE(BigInt(this.entryCount), 24);
        zip64End.writeBigUInt64LE(BigInt(this.entryCount), 32);
        zip64End.writeBigUInt64LE(BigInt(this.centralDirectorySize), 40);
        zip64End.writeBigUInt64LE(BigInt(centralDirectoryOffset), 48);
        const locator = Buffer.alloc(20);
        locator.writeUInt32LE(0x07064b50, 0);
        locator.writeBigUInt64LE(BigInt(zip64EndOffset), 8);
        locator.writeUInt32LE(1, 16);
        await file.write(zip64End);
        await file.write(locator);
      }
      end.writeUInt32LE(0x06054b50, 0);
      end.writeUInt16LE(requiresZip64 ? UINT16_MAX : this.entryCount, 8);
      end.writeUInt16LE(requiresZip64 ? UINT16_MAX : this.entryCount, 10);
      end.writeUInt32LE(
        requiresZip64 ? UINT32_MAX : this.centralDirectorySize,
        12,
      );
      end.writeUInt32LE(
        requiresZip64 ? UINT32_MAX : centralDirectoryOffset,
        16,
      );
      await file.write(end);
    } finally {
      await file.close();
      await rm(this.centralPath, { force: true });
      this.closed = true;
    }
  }

  /** Closes a partially-written archive so failed jobs do not leak file descriptors. */
  async abort() {
    if (this.closed) return;
    try {
      await (await this.filePromise).close();
    } finally {
      await (await this.centralFilePromise).close();
      await rm(this.centralPath, { force: true });
      this.closed = true;
    }
  }
}
