import { redactRpcSecrets } from 'src/web3/web3/rpc-providers';

/**
 * - `range_limit`: the endpoint caps the eth_getLogs block span. A property of
 *   the endpoint, so the worker learns a smaller max range; no penalty.
 * - `response_too_large`: the range is too dense. A property of the range, so
 *   the range is split; no penalty.
 * - `auth`: the API key was rejected (invalid, expired, disabled). For token
 *   providers this usually means the token itself is dead.
 * - `permanent`: the endpoint will not serve us (dead, paid-only, pruned).
 * - `rate_limited` / `transient`: back off and retry later.
 */
export type RpcErrorKind =
  | 'range_limit'
  | 'response_too_large'
  | 'auth'
  | 'permanent'
  | 'rate_limited'
  | 'transient';

export type ClassifiedRpcError = {
  kind: RpcErrorKind;
  /** Block span the endpoint said it accepts, when the message includes it. */
  suggestedMaxBlockRange: number | null;
  status: number | null;
  message: string;
};

// Each pattern captures the allowed block span from a provider message.
const RANGE_LIMIT_PATTERNS: RegExp[] = [
  /up to a (\d+) block range/i, // Alchemy, blastapi, meowrpc
  /ranges over (\d+) blocks are not supported/i, // dRPC free plan
  /block range exceeds limit of (\d+)/i, // baseazul
  /eth_getLogs is limited to a (\d+) range/i, // mainnet.base.org
  /maximum allowed number of requested blocks is (\d+)/i, // thirdweb
  /block range (?:is )?(?:too large|limit)[^\d]*(\d+)/i,
  /exceed(?:s|ed)? (?:the )?max(?:imum)? block range[^\d]*(\d+)/i,
];

const RANGE_LIMIT_NO_NUMBER =
  /requested range is over limit|block range|range (?:is )?too (?:large|wide)|too many blocks/i;

const RESPONSE_TOO_LARGE =
  /response body exceeded the size limit|response size exceeded|logs matched by query exceeds limit|query returned more than \d+ results|response is too big|too many (?:logs|results)/i;

const AUTH =
  /not in the key's ip whitelist|ip (?:address )?(?:is )?not (?:allowed|whitelisted)|api ?key (?:is )?(?:disabled|invalid|not found|expired|revoked)|invalid (?:api )?key|invalid token|token (?:is )?(?:invalid|expired|revoked)|key (?:has )?expired|tenant disabled|must be authenticated|unauthorized|authentication failed/i;

const PERMANENT =
  /discontinued|no longer available|requires a paid subscription|is not enabled for this app|pruned history|missing trie node|not supported on this network|forbidden|ENOTFOUND/i;

const RATE_LIMITED =
  /too many requests|rate limit|request limit reached|exceeded .*capacity|compute units|throughput/i;

function collectText(error: unknown, depth = 0): string[] {
  if (!error || typeof error !== 'object' || depth > 5) {
    return error === undefined || error === null ? [] : [String(error)];
  }

  const value = error as Record<string, unknown>;
  const parts = ['shortMessage', 'message', 'details']
    .map((key) => value[key])
    .filter((item): item is string => typeof item === 'string');

  return [...parts, ...collectText(value.cause, depth + 1)];
}

function findStatus(error: unknown, depth = 0): number | null {
  if (!error || typeof error !== 'object' || depth > 5) {
    return null;
  }

  const value = error as Record<string, unknown>;

  if (typeof value.status === 'number') {
    return value.status;
  }

  return findStatus(value.cause, depth + 1);
}

export function classifyRpcError(error: unknown): ClassifiedRpcError {
  const text = collectText(error).join('\n');
  const status = findStatus(error);
  const message = redactRpcSecrets(
    Array.from(new Set(text.split('\n').map((line) => line.trim())))
      .filter((line) => line && !line.startsWith('Request body:'))
      .join(' | ')
      .slice(0, 500),
  );

  const result = (
    kind: RpcErrorKind,
    suggestedMaxBlockRange: number | null = null,
  ): ClassifiedRpcError => ({ kind, suggestedMaxBlockRange, status, message });

  for (const pattern of RANGE_LIMIT_PATTERNS) {
    const match = pattern.exec(text);

    if (match) {
      const span = Number(match[1]);
      return result('range_limit', span > 0 ? span : null);
    }
  }

  if (RESPONSE_TOO_LARGE.test(text)) {
    return result('response_too_large');
  }

  if (RANGE_LIMIT_NO_NUMBER.test(text)) {
    return result('range_limit');
  }

  if (status === 429 || RATE_LIMITED.test(text)) {
    return result('rate_limited');
  }

  if (status === 401 || AUTH.test(text)) {
    return result('auth');
  }

  if (
    (status !== null && [402, 403, 404, 410].includes(status)) ||
    PERMANENT.test(text)
  ) {
    return result('permanent');
  }

  return result('transient');
}
