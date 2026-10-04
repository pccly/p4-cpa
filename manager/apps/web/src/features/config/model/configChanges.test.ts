import { describe, expect, it } from 'vitest';
import { getConfigChanges } from './configChanges';

describe('configuration change inspector', () => {
  it('ignores formatting and comments while preserving nested additions and removals', () => {
    expect(
      getConfigChanges(
        '# comment\nrouting: {strategy: round-robin}\n',
        'routing:\n  strategy: round-robin\n'
      )
    ).toEqual([]);
    expect(
      getConfigChanges(
        'routing: {strategy: round-robin, session-affinity: false}',
        'routing: {strategy: reset-first, session-affinity: true}'
      )
    ).toEqual([
      { path: 'routing.strategy', before: 'round-robin', after: 'reset-first', sensitive: false },
      { path: 'routing.session-affinity', before: 'false', after: 'true', sensitive: false },
    ]);
    expect(getConfigChanges('routing: {strategy: reset-first}', '{}')).toEqual([
      { path: 'routing.strategy', before: 'reset-first', after: undefined, sensitive: false },
    ]);
  });

  it('keeps credential changes visible without returning their values', () => {
    const changes = getConfigChanges(
      'remote-management: {secret-key: old-secret}\nproxy-url: https://old:pass@example.com\napi-keys: [old-key]',
      'remote-management: {secret-key: new-secret}\nproxy-url: https://new:pass@example.com\napi-keys: [new-key]'
    );
    expect(changes).toHaveLength(3);
    expect(
      changes?.every((change) => change.sensitive && change.before === '' && change.after === '')
    ).toBe(true);
    expect(JSON.stringify(changes)).not.toMatch(/old-secret|new-secret|old-key|new-key|https:/);
  });

  it('does not leak complex values on type changes or an initially empty document', () => {
    for (const original of ['', 'routing: 5']) {
      const changes = getConfigChanges(original, 'routing: {secret-key: hidden-secret}');
      expect(JSON.stringify(changes)).not.toContain('hidden-secret');
    }
  });

  it('reports invalid YAML without exposing parser excerpts', () => {
    expect(getConfigChanges('routing: [', '{}')).toBeNull();
    expect(getConfigChanges('{}', 'routing: [')).toBeNull();
  });

  it('returns to empty when edits match the baseline and distinguishes missing from empty', () => {
    expect(getConfigChanges('debug: false', 'debug: false')).toEqual([]);
    expect(getConfigChanges('{}', 'host: ""')).toEqual([
      { path: 'host', before: undefined, after: '', sensitive: false },
    ]);
  });
});
