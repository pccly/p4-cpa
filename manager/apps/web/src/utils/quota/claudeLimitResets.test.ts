import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mocks } = vi.hoisted(() => ({
  mocks: { request: vi.fn() },
}));

vi.mock('@/services/api/apiCall', () => ({
  apiCallApi: { request: mocks.request },
}));

import {
  fetchClaudeLimitResets,
  parseClaudeLimitResets,
  peekClaudeLimitResets,
  resetClaudeLimitResetsCacheForTests,
} from './claudeLimitResets';
import {
  CLAUDE_LIMIT_RESETS_BACKOFF_MS,
  CLAUDE_LIMIT_RESETS_REFRESH_MS,
  CLAUDE_LIMIT_RESETS_URL,
} from './constants';

const NOW = Date.parse('2026-11-18T05:00:00Z');

const grant = (overrides: Record<string, unknown> = {}) => ({
  id: 'grant-full',
  label: 'One full limit reset (November 2026)',
  resets_total: 1,
  resets_left: 1,
  starts_at: '2026-11-10T00:00:00Z',
  ends_at: '2026-12-10T22:00:00Z',
  paused: false,
  usable_now: true,
  type: 'full',
  ...overrides,
});

const ok = (body: unknown) => ({
  statusCode: 200,
  hasStatusCode: true,
  header: {},
  bodyText: '',
  body,
});

beforeEach(() => {
  resetClaudeLimitResetsCacheForTests();
  mocks.request.mockReset();
  vi.useRealTimers();
});

describe('parseClaudeLimitResets', () => {
  it('returns null when the cedar_ember block is missing, null or malformed', () => {
    expect(parseClaudeLimitResets(null, NOW)).toBeNull();
    expect(parseClaudeLimitResets({ five_hour: {} }, NOW)).toBeNull();
    expect(parseClaudeLimitResets({ cedar_ember: null }, NOW)).toBeNull();
    expect(parseClaudeLimitResets({ cedar_ember: { grants: [] } }, NOW)).toBeNull();
  });

  it('counts only grants with resets left, not paused and inside their window', () => {
    const result = parseClaudeLimitResets(
      {
        cedar_ember: {
          eligible: true,
          grants: [
            grant({ id: 'weekly', type: 'weekly', resets_left: 2, resets_total: 2 }),
            grant({ id: 'used', resets_left: 0, usable_now: true }),
            grant({ id: 'paused', paused: true }),
            grant({ id: 'expired', ends_at: '2026-11-01T00:00:00Z' }),
            grant({ id: 'future', starts_at: '2026-12-01T00:00:00Z' }),
            grant({ id: 'bad-type', type: 'mystery', ends_at: null }),
            { id: 'no-count' },
            'not-an-object',
          ],
        },
      },
      NOW
    );

    expect(result?.eligible).toBe(true);
    expect(result?.available).toBe(3);
    expect(result?.grants.map((item) => [item.id, item.available])).toEqual([
      ['expired', false],
      ['future', false],
      ['paused', false],
      ['used', false],
      ['weekly', true],
      ['bad-type', true],
    ]);
    expect(result?.grants.find((item) => item.id === 'bad-type')?.type).toBeNull();
  });

  it('reports zero available when the account is ineligible', () => {
    const result = parseClaudeLimitResets(
      { cedar_ember: { eligible: false, ineligible_reason: 'surface', grants: [grant()] } },
      NOW
    );
    expect(result).toMatchObject({ eligible: false, ineligibleReason: 'surface', available: 0 });
  });
});

describe('fetchClaudeLimitResets', () => {
  it('sends the Claude CLI request and caches the result for the refresh interval', async () => {
    mocks.request.mockResolvedValue(ok({ cedar_ember: { eligible: true, grants: [grant()] } }));
    vi.useFakeTimers({ now: NOW });

    const first = await fetchClaudeLimitResets('claude-1');
    vi.setSystemTime(NOW + 60_000);
    const second = await fetchClaudeLimitResets('claude-1');

    expect(first?.available).toBe(1);
    expect(second).toBe(first);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    const [request] = mocks.request.mock.calls[0];
    expect(request.url).toBe(CLAUDE_LIMIT_RESETS_URL);
    expect(request.authIndex).toBe('claude-1');
    expect(request.header['User-Agent']).toMatch(/^claude-cli\/\d+\.\d+\.\d+ \(external, cli\)$/);
    expect(request.header['anthropic-beta']).toBe('oauth-2025-04-20');
  });

  it('refetches after the refresh interval', async () => {
    mocks.request.mockResolvedValue(ok({ cedar_ember: { eligible: true, grants: [] } }));
    vi.useFakeTimers({ now: NOW });
    await fetchClaudeLimitResets('claude-1');
    vi.setSystemTime(NOW + CLAUDE_LIMIT_RESETS_REFRESH_MS + 1);
    await fetchClaudeLimitResets('claude-1');
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });

  it('keeps the last value and honors Retry-After on 429', async () => {
    vi.useFakeTimers({ now: NOW });
    mocks.request.mockResolvedValueOnce(ok({ cedar_ember: { eligible: true, grants: [grant()] } }));
    const first = await fetchClaudeLimitResets('claude-1');

    vi.setSystemTime(NOW + CLAUDE_LIMIT_RESETS_REFRESH_MS + 1);
    mocks.request.mockResolvedValueOnce({
      statusCode: 429,
      hasStatusCode: true,
      header: { 'Retry-After': ['7200'] },
      bodyText: '',
      body: null,
    });
    const limited = await fetchClaudeLimitResets('claude-1');
    expect(limited).toEqual(first);

    vi.setSystemTime(NOW + 2 * CLAUDE_LIMIT_RESETS_REFRESH_MS + 2);
    await fetchClaudeLimitResets('claude-1');
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });

  it('returns null without throwing when the request fails', async () => {
    mocks.request.mockRejectedValueOnce(new Error('network down'));
    await expect(fetchClaudeLimitResets('claude-1')).resolves.toBeNull();
  });

  it('does not back off after a canceled request', async () => {
    const canceled = Object.assign(new Error('canceled'), { name: 'CanceledError' });
    mocks.request
      .mockRejectedValueOnce(canceled)
      .mockResolvedValueOnce(ok({ cedar_ember: { eligible: true, grants: [] } }));
    await fetchClaudeLimitResets('claude-1');
    const result = await fetchClaudeLimitResets('claude-1');
    expect(result).toMatchObject({ eligible: true, available: 0 });
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight request per credential', async () => {
    mocks.request.mockResolvedValue(ok({ cedar_ember: { eligible: true, grants: [] } }));
    await Promise.all([
      fetchClaudeLimitResets('claude-1'),
      fetchClaudeLimitResets('claude-1'),
      fetchClaudeLimitResets('claude-2'),
    ]);
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });

  it('backs off after errors instead of retrying on every refresh', async () => {
    vi.useFakeTimers({ now: NOW });
    mocks.request
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({
        statusCode: 500,
        hasStatusCode: true,
        header: {},
        bodyText: '',
        body: null,
      })
      .mockResolvedValue(ok({ cedar_ember: { eligible: true, grants: [] } }));

    await fetchClaudeLimitResets('claude-1');
    vi.setSystemTime(NOW + 60_000);
    await fetchClaudeLimitResets('claude-1');
    expect(mocks.request).toHaveBeenCalledTimes(1);

    vi.setSystemTime(NOW + CLAUDE_LIMIT_RESETS_BACKOFF_MS + 1);
    await fetchClaudeLimitResets('claude-1');
    expect(mocks.request).toHaveBeenCalledTimes(2);
    vi.setSystemTime(NOW + CLAUDE_LIMIT_RESETS_BACKOFF_MS + 60_000);
    await fetchClaudeLimitResets('claude-1');
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['a short Retry-After', { 'retry-after': ['60'] }],
    ['no Retry-After', {}],
    ['an HTTP-date Retry-After', { 'Retry-After': [new Date(NOW + 60_000).toUTCString()] }],
  ])('waits at least the refresh interval after a 429 with %s', async (_name, header) => {
    vi.useFakeTimers({ now: NOW });
    mocks.request
      .mockResolvedValueOnce({
        statusCode: 429,
        hasStatusCode: true,
        header,
        bodyText: '',
        body: null,
      })
      .mockResolvedValue(ok({ cedar_ember: { eligible: true, grants: [] } }));
    await fetchClaudeLimitResets('claude-1');
    vi.setSystemTime(NOW + CLAUDE_LIMIT_RESETS_REFRESH_MS - 1);
    await fetchClaudeLimitResets('claude-1');
    expect(mocks.request).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW + CLAUDE_LIMIT_RESETS_REFRESH_MS + 1);
    await fetchClaudeLimitResets('claude-1');
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });

  it('clears the cached value when a later response has no resets block', async () => {
    vi.useFakeTimers({ now: NOW });
    mocks.request
      .mockResolvedValueOnce(ok({ cedar_ember: { eligible: true, grants: [grant()] } }))
      .mockResolvedValueOnce(ok({ five_hour: { utilization: 1 } }));
    expect((await fetchClaudeLimitResets('claude-1'))?.available).toBe(1);
    vi.setSystemTime(NOW + CLAUDE_LIMIT_RESETS_REFRESH_MS + 1);
    await expect(fetchClaudeLimitResets('claude-1')).resolves.toBeNull();
  });

  it('keeps separate cache entries when a credential file is replaced', async () => {
    vi.useFakeTimers({ now: NOW });
    mocks.request
      .mockResolvedValueOnce(ok({ cedar_ember: { eligible: true, grants: [grant()] } }))
      .mockResolvedValueOnce(ok({ cedar_ember: { eligible: false, grants: [] } }));
    expect((await fetchClaudeLimitResets('claude-1', undefined, 'old-account'))?.available).toBe(1);
    expect((await fetchClaudeLimitResets('claude-1', undefined, 'new-account'))?.eligible).toBe(
      false
    );
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });

  it('exposes the last known value without a request for loading and error states', async () => {
    mocks.request.mockResolvedValueOnce(ok({ cedar_ember: { eligible: true, grants: [grant()] } }));
    expect(peekClaudeLimitResets('claude-1', 'account-a')).toBeNull();
    await fetchClaudeLimitResets('claude-1', undefined, 'account-a');
    expect(peekClaudeLimitResets('claude-1', 'account-a')?.available).toBe(1);
    expect(peekClaudeLimitResets('claude-1', 'account-b')).toBeNull();
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
});
