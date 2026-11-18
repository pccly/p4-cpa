import { apiCallApi } from '@/services/api/apiCall';
import { createScopedApiRequestConfig, type ApiClientRequestScope } from '@/services/api/client';
import type { ClaudeLimitResetGrant, ClaudeLimitResets } from '@/types';
import {
  CLAUDE_LIMIT_RESETS_BACKOFF_MS,
  CLAUDE_LIMIT_RESETS_HEADERS,
  CLAUDE_LIMIT_RESETS_REFRESH_MS,
  CLAUDE_LIMIT_RESETS_URL,
} from './constants';

type CacheEntry = {
  value: ClaudeLimitResets | null;
  fetchedAtMs: number;
  retryAtMs: number;
  pending?: Promise<ClaudeLimitResets | null>;
};

const cache = new Map<string, CacheEntry>();

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const readCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

const parseTimeMs = (value: string | null): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const GRANT_TYPES = new Set(['session', 'weekly', 'full']);

/** Single availability rule: resets left, not paused, inside the grant window. */
export const isClaudeLimitResetGrantAvailable = (
  grant: Pick<ClaudeLimitResetGrant, 'resetsLeft' | 'paused' | 'startsAtMs' | 'endsAtMs'>,
  nowMs: number
) =>
  grant.resetsLeft > 0 &&
  !grant.paused &&
  (grant.startsAtMs === null || grant.startsAtMs <= nowMs) &&
  (grant.endsAtMs === null || grant.endsAtMs > nowMs);

const parseGrant = (value: unknown): ClaudeLimitResetGrant | null => {
  const record = asRecord(value);
  if (!record) return null;
  const id = readString(record.id);
  const resetsLeft = readCount(record.resets_left);
  if (!id || resetsLeft === null) return null;
  const type = readString(record.type);
  const startsAtMs = parseTimeMs(readString(record.starts_at));
  const endsAtMs = parseTimeMs(readString(record.ends_at));
  const paused = record.paused === true;
  return {
    id,
    label: readString(record.label) ?? '',
    type: type && GRANT_TYPES.has(type) ? (type as ClaudeLimitResetGrant['type']) : null,
    resetsLeft,
    resetsTotal: readCount(record.resets_total) ?? resetsLeft,
    startsAtMs,
    endsAtMs,
    paused,
    available: false,
  };
};

const withAvailability = (grant: ClaudeLimitResetGrant, nowMs: number): ClaudeLimitResetGrant => ({
  ...grant,
  available: isClaudeLimitResetGrantAvailable(grant, nowMs),
});

/**
 * Parses the undocumented `cedar_ember` block that /api/oauth/usage returns when
 * called with `cedar_ember=1`. A grant counts as available only when it has
 * resets left, is not paused and is inside its start/end window; `usable_now`
 * alone is not trusted.
 */
export const parseClaudeLimitResets = (
  payload: unknown,
  nowMs: number = Date.now()
): ClaudeLimitResets | null => {
  const root = asRecord(payload);
  const block = asRecord(root?.cedar_ember);
  if (!block || typeof block.eligible !== 'boolean') return null;
  const rawGrants = Array.isArray(block.grants) ? block.grants : [];
  const grants = rawGrants
    .map((grant) => parseGrant(grant))
    .filter((grant): grant is ClaudeLimitResetGrant => grant !== null)
    .map((grant) => withAvailability(grant, nowMs))
    .sort(
      (left, right) =>
        (left.endsAtMs ?? Number.POSITIVE_INFINITY) -
          (right.endsAtMs ?? Number.POSITIVE_INFINITY) || left.id.localeCompare(right.id)
    );
  const available = block.eligible
    ? grants.filter((grant) => grant.available).reduce((sum, grant) => sum + grant.resetsLeft, 0)
    : 0;
  return {
    eligible: block.eligible,
    ineligibleReason: readString(block.ineligible_reason),
    available,
    grants,
  };
};

const retryAfterMs = (header: Record<string, string[]> | undefined): number | null => {
  if (!header) return null;
  const key = Object.keys(header).find((name) => name.toLowerCase() === 'retry-after');
  const raw = key ? header[key]?.[0] : undefined;
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
};

/**
 * Fetches Claude limit resets at most once per refresh interval per credential.
 * The endpoint is rate limited harder than plain usage, so failures and 429s
 * keep the last known value and back off instead of retrying on every refresh.
 */
export const fetchClaudeLimitResets = async (
  authIndex: string,
  requestScope?: ApiClientRequestScope,
  credentialKey: string = authIndex
): Promise<ClaudeLimitResets | null> => {
  const nowMs = Date.now();
  const cacheKey = `${authIndex}\u0000${credentialKey}`;
  const entry = cache.get(cacheKey);
  if (entry?.pending) return entry.pending;
  if (entry && nowMs < entry.retryAtMs) return entry.value;

  const requestConfig = requestScope ? createScopedApiRequestConfig(requestScope) : undefined;
  const pending = (async () => {
    try {
      const result = await apiCallApi.request(
        {
          authIndex,
          method: 'GET',
          url: CLAUDE_LIMIT_RESETS_URL,
          header: { ...CLAUDE_LIMIT_RESETS_HEADERS },
        },
        requestConfig
      );
      if (result.statusCode >= 200 && result.statusCode < 300) {
        const parsed = parseClaudeLimitResets(result.body ?? result.bodyText, Date.now());
        const value = parsed;
        cache.set(cacheKey, {
          value,
          fetchedAtMs: Date.now(),
          retryAtMs: Date.now() + CLAUDE_LIMIT_RESETS_REFRESH_MS,
        });
        return value;
      }
      const backoff =
        result.statusCode === 429
          ? Math.max(retryAfterMs(result.header) ?? 0, CLAUDE_LIMIT_RESETS_REFRESH_MS)
          : CLAUDE_LIMIT_RESETS_BACKOFF_MS;
      cache.set(cacheKey, {
        value: entry?.value ?? null,
        fetchedAtMs: entry?.fetchedAtMs ?? 0,
        retryAtMs: Date.now() + backoff,
      });
      return entry?.value ?? null;
    } catch (error) {
      const canceled =
        (error as { name?: unknown })?.name === 'CanceledError' ||
        (error as { code?: unknown })?.code === 'ERR_CANCELED';
      cache.set(cacheKey, {
        value: entry?.value ?? null,
        fetchedAtMs: entry?.fetchedAtMs ?? 0,
        retryAtMs: canceled ? (entry?.retryAtMs ?? 0) : Date.now() + CLAUDE_LIMIT_RESETS_BACKOFF_MS,
      });
      return entry?.value ?? null;
    }
  })();
  cache.set(cacheKey, {
    value: entry?.value ?? null,
    fetchedAtMs: entry?.fetchedAtMs ?? 0,
    retryAtMs: entry?.retryAtMs ?? 0,
    pending,
  });
  return pending;
};

/** Last known resets for a credential, without a request; keeps the card stable while quota reloads. */
export const peekClaudeLimitResets = (
  authIndex: string,
  credentialKey: string = authIndex
): ClaudeLimitResets | null => cache.get(`${authIndex}\u0000${credentialKey}`)?.value ?? null;

export const resetClaudeLimitResetsCacheForTests = () => cache.clear();
