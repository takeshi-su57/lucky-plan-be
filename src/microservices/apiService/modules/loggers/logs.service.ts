import { Injectable, Logger } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';
import { LogSeverity } from 'generated/prisma/client';
import { createGunzip, createGzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { createReadStream, promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import * as readline from 'node:readline';
import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

import { PrismaService } from 'src/global/prisma.service';
import {
  Log,
  LogReviewWeek,
  LogsConnection,
  SeverityCount,
} from './entities/log.entity';
import { SUBSCRIPTION_TOKEN } from 'src/utils/constants';
import { CreateLogInput } from './dto/log.dto';
import { PUB_SUB } from 'src/global/global.module';
import { Inject } from '@nestjs/common';
import { redactLogText } from 'src/global/log-redaction';

type StoredLog = {
  id: string;
  severity: LogSeverity;
  timestamp: string;
  summary: string;
  details: string | null;
  service: string;
};

type LogFile = { path: string; date: string; service: string };

const LOG_FILE = /^(.+)-(\d{4}-\d{2}-\d{2})\.jsonl(?:\.gz)?$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const COUNTS_CACHE_MS = 60_000;

@Injectable()
export class LogsService {
  private readonly logger = new Logger(LogsService.name);
  private readonly logDirectory = resolve(
    process.env.LOG_DIRECTORY ?? join(process.cwd(), 'logs'),
  );
  private readonly fileLogger: winston.Logger;
  private severityCountsCache:
    | { expiresAt: number; value: SeverityCount[] }
    | undefined;

  constructor(
    private readonly prismaService: PrismaService,
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
  ) {
    this.fileLogger = winston.createLogger({
      level: 'debug',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json(),
      ),
      transports: [
        new DailyRotateFile({
          dirname: this.logDirectory,
          filename: 'application-%DATE%.jsonl',
          datePattern: 'YYYY-MM-DD',
          zippedArchive: true,
          maxFiles: '30d',
          level: 'debug',
          auditFile: join(this.logDirectory, '.application-log-audit.json'),
        }),
      ],
    });
  }

  async nativeLog(logInput: CreateLogInput): Promise<void> {
    await this.write(logInput);
  }

  async log(logInput: CreateLogInput): Promise<void> {
    await this.write(logInput);
  }

  async check(id: string, reviewedBy: string): Promise<Log> {
    const record = await this.findById(id);
    if (!record) throw new Error('Log not found in the retained log files');

    await this.reviewWeek(this.weekStart(record.timestamp), reviewedBy);

    return this.toLog(record, true);
  }

  async reviewWeek(
    weekStart: Date,
    reviewedBy: string,
  ): Promise<LogReviewWeek> {
    const normalized = this.weekStart(weekStart);
    if (normalized >= this.weekStart(new Date())) {
      throw new Error('Only completed weeks can be marked as reviewed');
    }
    const review = await this.prismaService.logReview.upsert({
      where: { weekStart: normalized },
      create: { weekStart: normalized, reviewedBy },
      update: { reviewedAt: new Date(), reviewedBy },
    });
    return review;
  }

  async getReviewWeeks(): Promise<LogReviewWeek[]> {
    const currentWeek = this.weekStart(new Date()).getTime();
    const logs = await this.readLogs();
    const weeks = [
      ...new Set(
        logs
          .map((record) => this.weekStart(record.timestamp))
          .filter((weekStart) => weekStart.getTime() < currentWeek)
          .map((weekStart) => weekStart.toISOString()),
      ),
    ]
      .map((value) => new Date(value))
      .sort((a, b) => b.getTime() - a.getTime());
    const reviews = await this.prismaService.logReview.findMany({
      where: { weekStart: { in: weeks } },
    });
    const byWeek = new Map(
      reviews.map((review) => [review.weekStart.toISOString(), review]),
    );
    return weeks.map((weekStart) => {
      const review = byWeek.get(weekStart.toISOString());
      return {
        weekStart,
        reviewedAt: review?.reviewedAt ?? null,
        reviewedBy: review?.reviewedBy ?? null,
      };
    });
  }

  async getSeverityCounts(): Promise<SeverityCount[]> {
    if (
      this.severityCountsCache &&
      this.severityCountsCache.expiresAt > Date.now()
    ) {
      return this.severityCountsCache.value;
    }
    const logs = await this.readLogs();
    const reviewedWeeks = await this.reviewWeekKeys();
    const counts = new Map<LogSeverity, number>();
    for (const record of logs) {
      if (reviewedWeeks.has(this.weekStart(record.timestamp).toISOString()))
        continue;
      counts.set(record.severity, (counts.get(record.severity) ?? 0) + 1);
    }
    const value = [...counts.entries()].map(([severity, count]) => ({
      severity,
      counts: count,
    }));
    this.severityCountsCache = {
      value,
      expiresAt: Date.now() + COUNTS_CACHE_MS,
    };
    return value;
  }

  async allLogs(
    severity: LogSeverity | null,
    checked: boolean,
    first: number,
    after: string | null,
  ): Promise<LogsConnection> {
    const limit = Math.min(Math.max(first, 1), 200);
    const reviewedWeeks = await this.reviewWeekKeys();
    const legacyRecords = await this.readLegacyLogs();
    if (legacyRecords.length > 0) {
      const records = [
        ...legacyRecords,
        ...(await this.readAllFileLogs()),
      ].sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
      return this.paginateRecords(
        records,
        reviewedWeeks,
        severity,
        checked,
        limit,
        after,
      );
    }
    const candidates: StoredLog[] = [];
    const fallback: StoredLog[] = [];
    let foundCursor = !after;

    const files = await this.logFiles();
    const dates = [...new Set(files.map((file) => file.date))];
    files: for (const date of dates) {
      const records = (
        await Promise.all(
          files
            .filter((file) => file.date === date)
            .map((file) => this.readFileLogs(file)),
        )
      )
        .flat()
        .sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        );
      for (const record of records) {
        const isChecked = reviewedWeeks.has(
          this.weekStart(record.timestamp).toISOString(),
        );
        if (
          (!severity || record.severity === severity) &&
          isChecked === checked
        ) {
          if (fallback.length <= limit) fallback.push(record);
          if (!foundCursor) {
            if (record.id === after) foundCursor = true;
            continue;
          }
          candidates.push(record);
          if (candidates.length > limit) break files;
        }
      }
    }

    const page = (foundCursor ? candidates : fallback).slice(0, limit + 1);
    const hasNextPage = page.length > limit;
    const edges = page.slice(0, limit).map((record) => ({
      cursor: record.id,
      node: this.toLog(
        record,
        reviewedWeeks.has(this.weekStart(record.timestamp).toISOString()),
      ),
    }));
    return {
      edges,
      pageInfo: {
        hasNextPage,
        endCursor: edges.at(-1)?.cursor ?? null,
      },
    };
  }

  async createExportStream(from: string, to: string): Promise<Readable> {
    const fromDate = this.parseDate(from);
    const toDate = this.parseDate(to);
    if (
      toDate < fromDate ||
      toDate.getTime() - fromDate.getTime() >= 30 * DAY_MS
    ) {
      throw new Error('The export range must be between one and thirty days');
    }
    return Readable.from(this.exportLines(fromDate, toDate)).pipe(createGzip());
  }

  private async write(input: CreateLogInput): Promise<void> {
    const record: StoredLog = {
      id: randomUUID(),
      severity: input.severity,
      summary: this.redact(input.summary),
      details: input.details ? this.redact(input.details) : null,
      service: input.service ?? process.env.SERVICE ?? 'API_SERVICE',
      timestamp: new Date().toISOString(),
    };
    this.fileLogger.log({
      level: this.winstonLevel(record.severity),
      message: record.summary,
      ...record,
    });
    this.severityCountsCache = undefined;
    await this.pubSub.publish(SUBSCRIPTION_TOKEN.newLog, {
      [SUBSCRIPTION_TOKEN.newLog]: { ...record, checked: false },
    });
  }

  private async findById(id: string): Promise<StoredLog | null> {
    return (await this.readLogs()).find((record) => record.id === id) ?? null;
  }

  private async readLogs(): Promise<StoredLog[]> {
    const [legacyRecords, fileRecords] = await Promise.all([
      this.readLegacyLogs(),
      this.readAllFileLogs(),
    ]);
    return [...legacyRecords, ...fileRecords].sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }

  private async readAllFileLogs(): Promise<StoredLog[]> {
    const records: StoredLog[] = [];
    for (const file of await this.logFiles()) {
      for (const record of await this.readFileLogs(file)) records.push(record);
    }
    return records.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }

  private async readLegacyLogs(): Promise<StoredLog[]> {
    const cutoff = new Date(Date.now() - 30 * DAY_MS);
    const records = await this.prismaService.legacyLog.findMany({
      where: { timestamp: { gte: cutoff } },
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
    });
    return records.map((record) => ({
      id: `legacy-${record.id}`,
      severity: record.severity,
      timestamp: record.timestamp.toISOString(),
      summary: redactLogText(record.summary),
      details: record.details ? redactLogText(record.details) : null,
      service: 'LEGACY_DATABASE',
    }));
  }

  private paginateRecords(
    records: StoredLog[],
    reviewedWeeks: Set<string>,
    severity: LogSeverity | null,
    checked: boolean,
    limit: number,
    after: string | null,
  ): LogsConnection {
    const filtered = records.filter((record) => {
      const isChecked = reviewedWeeks.has(
        this.weekStart(record.timestamp).toISOString(),
      );
      return (
        (!severity || record.severity === severity) && isChecked === checked
      );
    });
    const offset = after
      ? filtered.findIndex((record) => record.id === after) + 1
      : 0;
    const page = filtered.slice(
      Math.max(offset, 0),
      Math.max(offset, 0) + limit + 1,
    );
    const edges = page.slice(0, limit).map((record) => ({
      cursor: record.id,
      node: this.toLog(
        record,
        reviewedWeeks.has(this.weekStart(record.timestamp).toISOString()),
      ),
    }));
    return {
      edges,
      pageInfo: {
        hasNextPage: page.length > limit,
        endCursor: edges.at(-1)?.cursor ?? null,
      },
    };
  }

  private async reviewWeekKeys(): Promise<Set<string>> {
    const reviews = await this.prismaService.logReview.findMany();
    return new Set(reviews.map((review) => review.weekStart.toISOString()));
  }

  private async logFiles(): Promise<LogFile[]> {
    try {
      const files = await fs.readdir(this.logDirectory);
      return files
        .map((name) => ({ name, match: LOG_FILE.exec(name) }))
        .filter((item): item is { name: string; match: RegExpExecArray } =>
          Boolean(item.match),
        )
        .map((item) => ({
          path: join(this.logDirectory, item.name),
          service: item.match[1],
          date: item.match[2],
        }))
        .sort((a, b) => b.date.localeCompare(a.date));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  private weekStart(value: string | Date): Date {
    const date = new Date(value);
    const day = (date.getUTCDay() + 6) % 7;
    return new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate() - day,
      ),
    );
  }

  private parseDate(value: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw new Error('Dates must use YYYY-MM-DD');
    const date = new Date(`${value}T00:00:00.000Z`);
    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    ) {
      throw new Error('Invalid date');
    }
    return date;
  }

  private isStoredLog(value: Partial<StoredLog>): value is StoredLog {
    return (
      typeof value.id === 'string' &&
      typeof value.timestamp === 'string' &&
      typeof value.summary === 'string' &&
      typeof value.service === 'string' &&
      typeof value.severity === 'string'
    );
  }

  private async readFileLogs(file: LogFile): Promise<StoredLog[]> {
    try {
      const data = await fs.readFile(file.path);
      const text = file.path.endsWith('.gz')
        ? (await import('node:zlib')).gunzipSync(data).toString('utf8')
        : data.toString('utf8');
      return text
        .split('\n')
        .flatMap((line, index) => this.parseLine(line, file, index + 1) ?? [])
        .sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        );
    } catch (error) {
      this.logger.warn(
        `Unable to read log file ${file.path}: ${String(error)}`,
      );
      return [];
    }
  }

  private parseLine(
    line: string,
    file: LogFile,
    lineNumber: number,
  ): StoredLog | null {
    if (!line) return null;
    try {
      const parsed = JSON.parse(line) as Partial<StoredLog> & {
        level?: string;
        message?: unknown;
        context?: unknown;
        stack?: unknown;
      };
      if (this.isStoredLog(parsed)) return parsed;
      if (
        typeof parsed.timestamp !== 'string' ||
        typeof parsed.message !== 'string'
      )
        return null;
      return {
        id: createHash('sha256')
          .update(`${file.path}:${lineNumber}:${line}`)
          .digest('hex'),
        timestamp: parsed.timestamp,
        summary: redactLogText(parsed.message),
        details: this.detailsFromParsedLog(parsed),
        service:
          typeof parsed.service === 'string' ? parsed.service : file.service,
        severity: this.severityFromLevel(parsed.level),
      };
    } catch {
      return null;
    }
  }

  private detailsFromParsedLog(
    parsed: Partial<StoredLog> & { context?: unknown; stack?: unknown },
  ): string | null {
    if (typeof parsed.details === 'string' && parsed.details) {
      return redactLogText(parsed.details);
    }

    const stack = Array.isArray(parsed.stack)
      ? parsed.stack.filter((line): line is string => typeof line === 'string').join('\n')
      : typeof parsed.stack === 'string'
        ? parsed.stack
        : null;
    const context =
      typeof parsed.context === 'string' ? `Context: ${parsed.context}` : null;
    const details = [context, stack].filter(Boolean).join('\n\n');

    return details ? redactLogText(details) : null;
  }

  private async *exportLines(
    fromDate: Date,
    toDate: Date,
  ): AsyncGenerator<string> {
    for (const record of await this.readLegacyLogs()) {
      const timestamp = new Date(record.timestamp).getTime();
      if (
        timestamp >= fromDate.getTime() &&
        timestamp < toDate.getTime() + DAY_MS
      ) {
        yield `${JSON.stringify(record)}\n`;
      }
    }
    for (const file of await this.logFiles()) {
      const source = file.path.endsWith('.gz')
        ? createReadStream(file.path).pipe(createGunzip())
        : createReadStream(file.path);
      const lines = readline.createInterface({
        input: source,
        crlfDelay: Infinity,
      });
      let lineNumber = 0;
      for await (const line of lines) {
        const record = this.parseLine(line, file, ++lineNumber);
        if (!record) continue;
        const timestamp = new Date(record.timestamp).getTime();
        if (
          timestamp >= fromDate.getTime() &&
          timestamp < toDate.getTime() + DAY_MS
        ) {
          yield `${JSON.stringify(record)}\n`;
        }
      }
    }
  }

  private toLog(record: StoredLog, checked: boolean): Log {
    return { ...record, timestamp: new Date(record.timestamp), checked };
  }

  private winstonLevel(severity: LogSeverity): string {
    if (['Emergency', 'Alert', 'Critical', 'Error'].includes(severity))
      return 'error';
    if (severity === 'Warning') return 'warn';
    if (severity === 'Debug') return 'debug';
    return 'info';
  }

  private severityFromLevel(level: string | undefined): LogSeverity {
    if (level === 'error') return LogSeverity.Error;
    if (level === 'warn') return LogSeverity.Warning;
    if (level === 'debug') return LogSeverity.Debug;
    return LogSeverity.Info;
  }

  private redact(value: string): string {
    return redactLogText(value);
  }
}
