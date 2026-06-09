import { resolveFieldPath, resolveFieldPathAsString } from './field-path.util.js';

describe('resolveFieldPath', () => {
  it('resolves a simple top-level key', () => {
    expect(resolveFieldPath({ id: 123 }, 'id')).toBe(123);
  });

  it('resolves a nested dot path', () => {
    expect(
      resolveFieldPath({ Account_Name: { id: 'A1' } }, 'Account_Name.id'),
    ).toBe('A1');
  });

  it('resolves a deeply nested path (3+ levels)', () => {
    expect(
      resolveFieldPath({ a: { b: { c: 'deep' } } }, 'a.b.c'),
    ).toBe('deep');
  });

  it('returns undefined for missing intermediate keys', () => {
    expect(resolveFieldPath({}, 'a.b.c')).toBeUndefined();
  });

  it('returns undefined for null intermediate', () => {
    expect(resolveFieldPath({ a: null }, 'a.b')).toBeUndefined();
  });

  it('returns undefined for non-object intermediate', () => {
    expect(resolveFieldPath({ a: 'string' }, 'a.b')).toBeUndefined();
  });

  it('returns undefined for empty path', () => {
    expect(resolveFieldPath({ id: 1 }, '')).toBeUndefined();
  });

  it('returns the value even if it is falsy (0, false, empty string)', () => {
    expect(resolveFieldPath({ count: 0 }, 'count')).toBe(0);
    expect(resolveFieldPath({ active: false }, 'active')).toBe(false);
    expect(resolveFieldPath({ name: '' }, 'name')).toBe('');
  });
});

describe('resolveFieldPathAsString', () => {
  it('returns string for a resolved value', () => {
    expect(resolveFieldPathAsString({ id: 123 }, 'id')).toBe('123');
  });

  it('returns empty string for null value', () => {
    expect(resolveFieldPathAsString({ val: null }, 'val')).toBe('');
  });

  it('returns empty string for undefined / missing path', () => {
    expect(resolveFieldPathAsString({}, 'missing.key')).toBe('');
  });

  it('returns "false" for boolean false', () => {
    expect(resolveFieldPathAsString({ flag: false }, 'flag')).toBe('false');
  });

  it('returns "0" for numeric zero', () => {
    expect(resolveFieldPathAsString({ n: 0 }, 'n')).toBe('0');
  });
});
