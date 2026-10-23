import { describe, expect, test } from 'bun:test';
import { anchorMatchesPath, parseAnchor, prLineUrl } from './anchor';

describe('anchor parser', () => {
  test('strips a pr prefix', () => {
    expect(parseAnchor('pr-12:a/b.ts:10')).toEqual({ path: 'a/b.ts', line: 10 });
  });

  test('strips an origin branch prefix', () => {
    expect(parseAnchor('origin/main:x.tsx:5')).toEqual({ path: 'x.tsx', line: 5 });
  });

  test('a ref without a line has no anchor', () => {
    expect(parseAnchor('a/b.ts')).toBeNull();
    expect(parseAnchor(undefined)).toBeNull();
  });

  test('a line range anchors on its first line', () => {
    expect(parseAnchor('a/b.ts:7-9')).toEqual({ path: 'a/b.ts', line: 7 });
  });
});

describe('anchor path match', () => {
  test('matches equal paths and paths that differ by a leading directory', () => {
    expect(anchorMatchesPath('a/b.ts', 'a/b.ts')).toBe(true);
    expect(anchorMatchesPath('b.ts', 'a/b.ts')).toBe(true);
    expect(anchorMatchesPath('a/b.ts', 'b.ts')).toBe(true);
    expect(anchorMatchesPath('a/b.ts', 'a/xb.ts')).toBe(false);
  });
});

describe('pr line url', () => {
  test('anchors on the sha256 of the path and the new side line', async () => {
    expect(await prLineUrl('https://github.com/o/r/pull/7/', 'a/b.ts', 12)).toBe(
      'https://github.com/o/r/pull/7/files#diff-868d928140a1e61dca524d263e944cae53f46fb5800455698f5ca66c207f5e40R12',
    );
  });
});
