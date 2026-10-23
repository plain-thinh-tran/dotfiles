#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { findingTodos, latestTally, modeFor, resolveLogin, runIdFor } from '../src/prc';

const contextDir = process.argv[2];
const summaryArg = process.argv[3];
if (contextDir === undefined) {
  console.error('usage: prc-to-mc.ts <prod-ready-check context dir> [summary sentence]');
  process.exit(1);
}

const patchPath = join(contextDir, 'diff.patch');
const patch = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '';

const overviewPath = join(contextDir, 'overview.md');
const overview = existsSync(overviewPath) ? readFileSync(overviewPath, 'utf8').trim() : '';

const tally = latestTally(contextDir);
const metaPath = join(contextDir, 'meta.json');
const meta: { number?: number; title?: string; url?: string; author?: { login?: string } } = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};
const pr = meta.number ?? Number(basename(resolve(contextDir)).replace('pr-', ''));

function lookupGhLogin(): string | null {
  try {
    const env = { ...process.env };
    delete env.GH_TOKEN;
    const result = Bun.spawnSync(['gh', 'api', 'user', '--jq', '.login'], { env, stdout: 'pipe', stderr: 'ignore' });
    const login = result.stdout.toString().trim();
    return result.exitCode === 0 && login !== '' ? login : null;
  } catch {
    return null;
  }
}

const authorLogin = meta.author?.login;
const mode = modeFor(authorLogin, resolveLogin(process.env, lookupGhLogin));
const todos = findingTodos(tally, patch, meta.url);

console.log(
  JSON.stringify(
    {
      runId: runIdFor(meta.url, contextDir, pr),
      skill: 'prod-ready-check',
      contextDir: resolve(contextDir),
      mode,
      ...(meta.url !== undefined ? { pr: { number: pr, url: meta.url, author: authorLogin ?? '' } } : {}),
      title: `PR #${pr} ${meta.title ?? ''}`.trim(),
      summary: summaryArg ?? meta.title ?? '',
      ...(overview !== '' ? { overview } : {}),
      agents: [
        { id: 'claude', name: 'Claude', role: 'orchestrator', harness: 'claude', model: 'claude-opus-5-5' },
        { id: 'codex', name: 'GPT-6 Sol', role: 'reviewer', harness: 'codex', model: process.env.CODEX_MODEL ?? 'gpt-6-sol' },
        { id: 'grok', name: 'Grok 4.6', role: 'reviewer', harness: 'cursor', model: process.env.GROK_MODEL ?? 'cursor-grok-4.6-medium' },
      ],
      todos,
    },
    null,
    2
  )
);
