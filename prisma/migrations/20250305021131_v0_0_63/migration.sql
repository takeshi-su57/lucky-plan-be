-- CreateIndex
CREATE INDEX "Log_severity_timestamp_idx" ON "Log"("severity", "timestamp" DESC);
