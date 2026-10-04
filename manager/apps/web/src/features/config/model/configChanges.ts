import { parseDocument } from 'yaml';

export interface ConfigChange {
  path: string;
  before?: string;
  after?: string;
  sensitive: boolean;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

// The always-visible inspector must not expose credentials, headers or proxy URLs.
const isSensitive = (path: string[]) =>
  path.some((key) => /key|secret|token|password|header|proxy|cert/i.test(key));

const preview = (value: unknown, sensitive: boolean): string | undefined => {
  if (value === undefined) return undefined;
  if (sensitive) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
};

export function getConfigChanges(original: string, modified: string): ConfigChange[] | null {
  try {
    const before = parseDocument(original);
    const after = parseDocument(modified);
    if (before.errors.length || after.errors.length) return null;
    const changes: ConfigChange[] = [];
    const visit = (oldValue: unknown, newValue: unknown, path: string[]) => {
      if (
        (isObject(oldValue) || oldValue === undefined) &&
        (isObject(newValue) || newValue === undefined)
      ) {
        const oldObject = oldValue ?? {};
        const newObject = newValue ?? {};
        for (const key of new Set([...Object.keys(oldObject), ...Object.keys(newObject)])) {
          visit(oldObject[key], newObject[key], [...path, key]);
        }
        return;
      }
      if (JSON.stringify(oldValue) === JSON.stringify(newValue)) return;
      // Arrays can contain arbitrary payloads or provider credentials. Summarize them
      // without copying their contents into the persistent inspector.
      const sensitive =
        isSensitive(path) ||
        Array.isArray(oldValue) ||
        Array.isArray(newValue) ||
        isObject(oldValue) ||
        isObject(newValue);
      changes.push({
        path: path.join('.'),
        before: preview(oldValue, sensitive),
        after: preview(newValue, sensitive),
        sensitive,
      });
    };
    visit(before.toJS(), after.toJS(), []);
    return changes;
  } catch {
    return null;
  }
}
