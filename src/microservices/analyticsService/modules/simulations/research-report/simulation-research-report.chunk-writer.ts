import { ResearchReportArchive } from './simulation-research-report.archive';

export const REPORT_CHUNK_MAX_ROWS = 10_000;
export const REPORT_CHUNK_MAX_BYTES = 16 * 1024 * 1024;

export function csvCell(value: unknown) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Keeps one JSONL or CSV chunk in memory, then immediately archives it. */
export class ResearchReportChunkWriter {
  private parts: string[] = [];
  private bytes = 0;
  private rows = 0;
  private part = 0;
  readonly files: string[] = [];

  constructor(
    private readonly archive: ResearchReportArchive,
    private readonly directory: string,
    private readonly extension: 'jsonl' | 'csv',
    private readonly header?: string,
  ) {}

  async writeLine(line: string) {
    const text = `${line}\n`;
    const byteLength = Buffer.byteLength(text);
    if (
      this.rows > 0 &&
      (this.rows >= REPORT_CHUNK_MAX_ROWS ||
        this.bytes + byteLength > REPORT_CHUNK_MAX_BYTES)
    ) {
      await this.flush();
    }
    this.parts.push(text);
    this.rows += 1;
    this.bytes += byteLength;
  }

  async close() {
    await this.flush();
    return this.files;
  }

  private async flush() {
    if (this.rows === 0) return;
    this.part += 1;
    const filename = `${this.directory}/part-${String(this.part).padStart(5, '0')}.${this.extension}`;
    const content = this.header
      ? `${this.header}\n${this.parts.join('')}`
      : this.parts.join('');
    await this.archive.addText(filename, content);
    this.files.push(filename);
    this.parts = [];
    this.bytes = 0;
    this.rows = 0;
  }
}
