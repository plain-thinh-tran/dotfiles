export type Anchor = { path: string; line: number };

export function parseAnchor(ref: string | undefined): Anchor | null {
  if (ref === undefined) return null;
  const bare = ref.replace(/^pr-\d+:/, '').replace(/^origin\/[^:]+:/, '');
  const match = /^(.+?):(\d+)/.exec(bare);
  const path = match?.[1];
  const line = match?.[2];
  if (path === undefined || line === undefined) return null;
  return { path, line: Number(line) };
}

export function anchorMatchesPath(anchorPath: string, diffPath: string): boolean {
  return anchorPath === diffPath || diffPath.endsWith(`/${anchorPath}`) || anchorPath.endsWith(`/${diffPath}`);
}

export async function prLineUrl(prUrl: string, path: string, line: number): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(path));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${prUrl.replace(/\/$/, '')}/files#diff-${hex}R${line}`;
}
