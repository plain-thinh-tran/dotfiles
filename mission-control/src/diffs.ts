export type FileDiff = { path: string; patch: string };

type PatchFile = { path: string; hunks: string[] };

const MAX_HUNKS = 3;
const LOCATION_PATH = /([\w@./-]+\.[A-Za-z0-9]+)(?::(\d+))?/g;
const FILE_HEADER = /^diff --git a\/(.+) b\/(.+)$/;
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

function parsePatch(patch: string): PatchFile[] {
  const files: PatchFile[] = [];
  patch.split('\n').forEach((line) => {
    const header = FILE_HEADER.exec(line);
    if (header !== null) {
      files.push({ path: header[2] as string, hunks: [] });
      return;
    }
    const file = files[files.length - 1];
    if (file === undefined) return;
    if (line.startsWith('@@')) file.hunks.push(line);
    else if (file.hunks.length > 0) file.hunks[file.hunks.length - 1] += `\n${line}`;
  });
  return files;
}

function hunkContains(hunk: string, line: number): boolean {
  const match = HUNK_HEADER.exec(hunk);
  if (match === null) return false;
  const start = Number(match[1]);
  const length = match[2] === undefined ? 1 : Number(match[2]);
  return line >= start && line < start + length;
}

function sameFile(patchPath: string, token: string): boolean {
  return patchPath === token || patchPath.endsWith(`/${token}`) || token.endsWith(`/${patchPath}`);
}

export function extractDiffs(patch: string, location: string): FileDiff[] {
  const files = parsePatch(patch);
  const found = new Map<string, FileDiff>();
  for (const [, token, line] of location.matchAll(LOCATION_PATH)) {
    const file = files.find((candidate) => sameFile(candidate.path, token as string));
    if (file === undefined || found.has(file.path)) continue;
    const hunks = line === undefined ? file.hunks : file.hunks.filter((hunk) => hunkContains(hunk, Number(line)));
    if (hunks.length > 0) found.set(file.path, { path: file.path, patch: hunks.slice(0, MAX_HUNKS).join('\n').trimEnd() });
  }
  return [...found.values()];
}
