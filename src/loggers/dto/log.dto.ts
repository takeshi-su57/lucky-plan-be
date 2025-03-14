import { LogSeverity } from '@prisma/client';

export class CreateLogInput {
  severity: LogSeverity;
  summary: string;
  details?: string | null;
}
