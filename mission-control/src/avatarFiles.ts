import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_AVATAR_IDS, avatarSourceUrl } from './avatars';
import { mcHome } from './store';

const DOWNLOAD_TIMEOUT_MS = 15000;

export type AvatarDownloadResult = { present: number; downloaded: number; failed: number };

export function avatarsDir(): string {
  return join(mcHome(), 'avatars');
}

export function avatarPath(id: number): string {
  return join(avatarsDir(), `${id}.png`);
}

export function isAvatarId(id: number): boolean {
  return ALL_AVATAR_IDS.includes(id);
}

async function download(id: number): Promise<boolean> {
  try {
    const response = await fetch(avatarSourceUrl(id), { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok) return false;
    const path = avatarPath(id);
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, new Uint8Array(await response.arrayBuffer()));
    renameSync(tmp, path);
    return true;
  } catch {
    return false;
  }
}

export async function downloadMissingAvatars(): Promise<AvatarDownloadResult> {
  mkdirSync(avatarsDir(), { recursive: true });
  const missing = ALL_AVATAR_IDS.filter((id) => !existsSync(avatarPath(id)));
  const outcomes = await Promise.all(missing.map(download));
  const downloaded = outcomes.filter((ok) => ok).length;
  return { present: ALL_AVATAR_IDS.length - missing.length, downloaded, failed: missing.length - downloaded };
}
