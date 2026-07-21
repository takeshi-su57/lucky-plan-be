import { Injectable } from '@nestjs/common';
import { Platform, PnlSnapshotV2 } from 'generated/prisma/client';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PrismaService } from 'src/global/prisma.service';

const ROWS_PER_FILE = 10_000;
const CACHE_ROOT = resolve(process.cwd(), '.cache', 'PnlSnapshot');

type SnapshotRow = Pick<PnlSnapshotV2, 'address' | 'accUSDPnl'>;

interface ChunkIndex {
  file: number;
  rowCount: number;
  start: SnapshotRow;
  end: SnapshotRow;
}

interface SnapshotIndex {
  version: 1;
  orderBy: 'pnl-desc-address-asc' | 'address-asc';
  total: number;
  chunks: ChunkIndex[];
}

@Injectable()
export class PnlSnapshotFileCacheService {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Exports a completed database snapshot.  The temporary directory is renamed
   * only after both orderings and their indexes have been completely written.
   */
  async publish(platform: Platform, dateStr: string): Promise<void> {
    const target = this.getSnapshotPath(platform, dateStr);
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;

    await rm(temporary, { recursive: true, force: true });
    await mkdir(temporary, { recursive: true });

    try {
      await this.writeOrdering(temporary, platform, dateStr, 'pnl');
      await this.writeOrdering(temporary, platform, dateStr, 'address');

      // Renaming a directory over an existing non-empty directory is not
      // portable, so replace only this exact, validated cache target.
      await rm(target, { recursive: true, force: true });
      await mkdir(join(target, '..'), { recursive: true });
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
  }

  async invalidate(platform: Platform, dateStr: string): Promise<void> {
    await rm(this.getSnapshotPath(platform, dateStr), {
      recursive: true,
      force: true,
    });
  }

  /** Cache-native writer used after the one-time database backfill. */
  async publishRecords(
    platform: Platform,
    dateStr: string,
    records: Iterable<SnapshotRow>,
  ): Promise<void> {
    const rows = Array.from(records, (record) => ({
      address: record.address.toLowerCase(),
      accUSDPnl: record.accUSDPnl,
    }));
    const target = this.getSnapshotPath(platform, dateStr);
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
    await rm(temporary, { recursive: true, force: true });
    await mkdir(temporary, { recursive: true });
    try {
      await this.writeRowsOrdering(temporary, rows, 'pnl');
      await this.writeRowsOrdering(temporary, rows, 'address');
      await rm(target, { recursive: true, force: true });
      await mkdir(join(target, '..'), { recursive: true });
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
  }

  async readAllByAddress(
    platform: Platform,
    dateStr: string,
  ): Promise<SnapshotRow[] | null> {
    const index = await this.readIndex(platform, dateStr, 'orderByAddress');
    if (!index) return null;
    try {
      const rows: SnapshotRow[] = [];
      const directory = this.getOrderingPath(
        platform,
        dateStr,
        'orderByAddress',
      );
      for (const chunk of index.chunks) {
        rows.push(...(await this.readChunk(directory, chunk.file)));
      }
      return rows;
    } catch {
      return null;
    }
  }

  async exists(platform: Platform, dateStr: string): Promise<boolean> {
    const pnlIndex = await this.readIndex(platform, dateStr, 'orderByPnl');
    const addressIndex = await this.readIndex(
      platform,
      dateStr,
      'orderByAddress',
    );
    return (
      !!pnlIndex && !!addressIndex && pnlIndex.total === addressIndex.total
    );
  }

  async getPage(
    platform: Platform,
    dateStr: string,
    page: number,
    pageSize: number,
  ): Promise<{ total: number; records: SnapshotRow[] } | null> {
    try {
      const index = await this.readIndex(platform, dateStr, 'orderByPnl');
      if (!index) return null;

      const offset = Math.max(page, 0) * Math.max(pageSize, 1);
      if (offset >= index.total) return { total: index.total, records: [] };

      return {
        total: index.total,
        records: await this.readRange(
          this.getOrderingPath(platform, dateStr, 'orderByPnl'),
          index,
          offset,
          pageSize,
        ),
      };
    } catch {
      // A cache miss or a damaged cache must never make the leaderboard fail.
      return null;
    }
  }

  async findByAddress(
    platform: Platform,
    dateStr: string,
    address: string,
  ): Promise<SnapshotRow | null | undefined> {
    try {
      const index = await this.readIndex(platform, dateStr, 'orderByAddress');
      if (!index) return undefined;

      const normalizedAddress = address.toLowerCase();
      const chunk = this.findAddressChunk(index.chunks, normalizedAddress);
      if (!chunk) return null;

      const rows = await this.readChunk(
        this.getOrderingPath(platform, dateStr, 'orderByAddress'),
        chunk.file,
      );
      let low = 0;
      let high = rows.length - 1;

      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const candidate = rows[middle].address;
        if (candidate === normalizedAddress) return rows[middle];
        if (candidate < normalizedAddress) low = middle + 1;
        else high = middle - 1;
      }

      return null;
    } catch {
      return undefined;
    }
  }

  private async writeOrdering(
    temporarySnapshotPath: string,
    platform: Platform,
    dateStr: string,
    ordering: 'pnl' | 'address',
  ): Promise<void> {
    const directory = join(
      temporarySnapshotPath,
      ordering === 'pnl' ? 'orderByPnl' : 'orderByAddress',
    );
    await mkdir(directory, { recursive: true });

    const chunks: ChunkIndex[] = [];
    let addressCursor: string | null = null;
    let pnlCursor: SnapshotRow | null = null;
    let file = 1;

    while (true) {
      const rows: SnapshotRow[] =
        await this.prismaService.pnlSnapshotV2.findMany({
          take: ROWS_PER_FILE,
          where: {
            platform,
            dateStr,
            ...(ordering === 'address'
              ? {
                  address: addressCursor ? { gt: addressCursor } : undefined,
                }
              : pnlCursor
                ? {
                    OR: [
                      { accUSDPnl: { lt: pnlCursor.accUSDPnl } },
                      {
                        accUSDPnl: pnlCursor.accUSDPnl,
                        address: { gt: pnlCursor.address },
                      },
                    ],
                  }
                : {}),
          },
          orderBy:
            ordering === 'address'
              ? [{ address: 'asc' }]
              : [{ accUSDPnl: 'desc' }, { address: 'asc' }],
          select: { address: true, accUSDPnl: true },
        });

      if (rows.length === 0) break;

      const normalizedRows: SnapshotRow[] = rows.map((row: SnapshotRow) => ({
        address: row.address.toLowerCase(),
        accUSDPnl: row.accUSDPnl,
      }));
      await writeFile(
        join(directory, String(file)),
        normalizedRows
          .map((row) => `${row.address},${String(row.accUSDPnl)}`)
          .join('\n')
          .concat('\n'),
        'utf8',
      );
      chunks.push({
        file,
        rowCount: normalizedRows.length,
        start: normalizedRows[0],
        end: normalizedRows[normalizedRows.length - 1],
      });

      addressCursor = normalizedRows[normalizedRows.length - 1].address;
      pnlCursor = normalizedRows[normalizedRows.length - 1];
      file += 1;
    }

    const index: SnapshotIndex = {
      version: 1,
      orderBy: ordering === 'pnl' ? 'pnl-desc-address-asc' : 'address-asc',
      total: chunks.reduce((total, chunk) => total + chunk.rowCount, 0),
      chunks,
    };
    await writeFile(join(directory, 'index'), JSON.stringify(index), 'utf8');
  }

  private async writeRowsOrdering(
    temporarySnapshotPath: string,
    rows: SnapshotRow[],
    ordering: 'pnl' | 'address',
  ): Promise<void> {
    const directory = join(
      temporarySnapshotPath,
      ordering === 'pnl' ? 'orderByPnl' : 'orderByAddress',
    );
    await mkdir(directory, { recursive: true });
    const sorted = [...rows].sort(
      ordering === 'pnl'
        ? (left, right) =>
            right.accUSDPnl - left.accUSDPnl ||
            left.address.localeCompare(right.address)
        : (left, right) => left.address.localeCompare(right.address),
    );
    const chunks: ChunkIndex[] = [];
    for (let offset = 0; offset < sorted.length; offset += ROWS_PER_FILE) {
      const chunkRows = sorted.slice(offset, offset + ROWS_PER_FILE);
      const file = chunks.length + 1;
      await writeFile(
        join(directory, String(file)),
        chunkRows
          .map((row) => `${row.address},${String(row.accUSDPnl)}`)
          .join('\n')
          .concat('\n'),
        'utf8',
      );
      chunks.push({
        file,
        rowCount: chunkRows.length,
        start: chunkRows[0],
        end: chunkRows[chunkRows.length - 1],
      });
    }
    await writeFile(
      join(directory, 'index'),
      JSON.stringify({
        version: 1,
        orderBy: ordering === 'pnl' ? 'pnl-desc-address-asc' : 'address-asc',
        total: sorted.length,
        chunks,
      } satisfies SnapshotIndex),
      'utf8',
    );
  }

  private async readIndex(
    platform: Platform,
    dateStr: string,
    ordering: 'orderByPnl' | 'orderByAddress',
  ): Promise<SnapshotIndex | null> {
    try {
      const index = JSON.parse(
        await readFile(
          join(this.getOrderingPath(platform, dateStr, ordering), 'index'),
          'utf8',
        ),
      ) as SnapshotIndex;
      if (
        index.version !== 1 ||
        !Number.isInteger(index.total) ||
        !Array.isArray(index.chunks)
      ) {
        return null;
      }
      return index;
    } catch {
      return null;
    }
  }

  private async readRange(
    directory: string,
    index: SnapshotIndex,
    offset: number,
    limit: number,
  ): Promise<SnapshotRow[]> {
    const records: SnapshotRow[] = [];
    let skipped = 0;
    for (const chunk of index.chunks) {
      if (offset >= skipped + chunk.rowCount) {
        skipped += chunk.rowCount;
        continue;
      }
      const rows = await this.readChunk(directory, chunk.file);
      const start = Math.max(offset - skipped, 0);
      records.push(...rows.slice(start, start + limit - records.length));
      if (records.length === limit) break;
      skipped += chunk.rowCount;
    }
    return records;
  }

  private async readChunk(
    directory: string,
    file: number,
  ): Promise<SnapshotRow[]> {
    const contents = await readFile(join(directory, String(file)), 'utf8');
    return contents
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const separator = line.lastIndexOf(',');
        return {
          address: line.slice(0, separator),
          accUSDPnl: Number(line.slice(separator + 1)),
        };
      });
  }

  private findAddressChunk(
    chunks: ChunkIndex[],
    address: string,
  ): ChunkIndex | null {
    let low = 0;
    let high = chunks.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const chunk = chunks[middle];
      if (address < chunk.start.address) high = middle - 1;
      else if (address > chunk.end.address) low = middle + 1;
      else return chunk;
    }
    return null;
  }

  private getSnapshotPath(platform: Platform, dateStr: string): string {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(dateStr) ||
      !/^[A-Za-z0-9_-]+$/.test(platform)
    ) {
      throw new Error('Invalid PnlSnapshot cache path');
    }
    return join(CACHE_ROOT, dateStr, platform);
  }

  private getOrderingPath(
    platform: Platform,
    dateStr: string,
    ordering: 'orderByPnl' | 'orderByAddress',
  ): string {
    return join(this.getSnapshotPath(platform, dateStr), ordering);
  }
}
