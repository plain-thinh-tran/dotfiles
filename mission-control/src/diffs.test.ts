import { describe, expect, test } from 'bun:test';
import { extractDiffs } from './diffs';

const PATCH = `diff --git a/terraform/grouper.tf b/terraform/grouper.tf
index 111..222 100644
--- a/terraform/grouper.tf
+++ b/terraform/grouper.tf
@@ -10,4 +10,5 @@ module "grouper_queue"
   name = "ingest"
-  tags = local.tags
+  tags = merge(local.tags, {
+    Vanta = "true"
+  })
   fifo = false
@@ -40,2 +41,3 @@ module "other"
   a = 1
+  b = 2
@@ -60,2 +62,3 @@ module "third"
   c = 3
+  d = 4
@@ -80,2 +83,3 @@ module "fourth"
   e = 5
+  f = 6
diff --git a/src/handler.ts b/src/handler.ts
--- a/src/handler.ts
+++ b/src/handler.ts
@@ -1,2 +1,3 @@
 const x = 1;
+const y = 2;
`;

describe('extractDiffs', () => {
  test('returns only the hunk containing the given line', () => {
    const [diff] = extractDiffs(PATCH, 'terraform/grouper.tf:12');
    expect(diff?.path).toBe('terraform/grouper.tf');
    expect(diff?.patch.startsWith('@@ -10,4 +10,5 @@')).toBe(true);
    expect(diff?.patch).not.toContain('module "other"');
  });

  test('returns all hunks of the file, capped at three, when no line is given', () => {
    const [diff] = extractDiffs(PATCH, 'Missing grouper at terraform/grouper.tf');
    expect(diff?.patch.match(/^@@/gm)).toHaveLength(3);
  });

  test('matches a file by path suffix', () => {
    expect(extractDiffs(PATCH, 'handler.ts:2')[0]?.path).toBe('src/handler.ts');
  });

  test('returns nothing for unknown files or lines outside every hunk', () => {
    expect(extractDiffs(PATCH, 'nope/missing.ts:3')).toEqual([]);
    expect(extractDiffs(PATCH, 'terraform/grouper.tf:500')).toEqual([]);
  });

  test('collects every referenced file once', () => {
    const diffs = extractDiffs(PATCH, 'terraform/grouper.tf:12, src/handler.ts:2, terraform/grouper.tf:42');
    expect(diffs.map((d) => d.path)).toEqual(['terraform/grouper.tf', 'src/handler.ts']);
  });
});
