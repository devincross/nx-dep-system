/**
 * Resolve a dot-notation field path on a nested object.
 *
 * @example
 * resolveFieldPath({ Account_Name: { id: 'A1' } }, 'Account_Name.id') // 'A1'
 * resolveFieldPath({ id: 123 }, 'id') // 123
 * resolveFieldPath({}, 'a.b.c') // undefined
 */
export function resolveFieldPath(
  obj: Record<string, unknown>,
  path: string,
): unknown {
  if (!path) return undefined;

  const segments = path.split('.');
  let current: unknown = obj;

  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

/**
 * Resolve a dot-notation field path and return the result as a string.
 * Returns '' for nullish values.
 */
export function resolveFieldPathAsString(
  obj: Record<string, unknown>,
  path: string,
): string {
  const value = resolveFieldPath(obj, path);
  if (value === null || value === undefined) return '';
  return String(value);
}
