export const SYNC_PROMPT =
  'Sync Mission Control with this chat: for every decision or finding Thinh settled in the conversation, run ~/.claude/bin/mc resolve <runId> <id> "settled in chat: <what was decided>"; for ones whose content changed, update mc.json and run ~/.claude/bin/mc push. Leave open only what still needs him, then say which ids you resolved, updated and left open.';

export function syncPrompt(runIds: string[]): string {
  return runIds.length === 0 ? SYNC_PROMPT : `${SYNC_PROMPT}\n\nRuns: ${runIds.join(', ')}`;
}
