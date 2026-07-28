const SENSITIVE_VALUE =
  /(["']?(?:authorization|token|password|mnemonic|signature|privateKey|cookie)["']?\s*[:=]\s*["']?)(?:Bearer\s+)?[^\s,"';}\]]+/gi;
const JWT = /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g;
const PRIVATE_HEX = /0x[a-fA-F0-9]{64,}/g;

export function redactLogText(value: string): string {
  return value
    .replace(SENSITIVE_VALUE, '$1[REDACTED]')
    .replace(JWT, '[REDACTED_JWT]')
    .replace(PRIVATE_HEX, '[REDACTED_HEX]');
}
