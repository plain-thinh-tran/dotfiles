import { describe, expect, test } from 'bun:test';
import type { Agent, Position } from '../src/types';
import { alsoRaisedLine, consensusLine, stanceWord } from './reviewerText';

const agents: Agent[] = [
  { id: 'claude', name: 'Claude', role: 'orchestrator', harness: 'claude', model: '' },
  { id: 'codex', name: 'Codex', role: 'reviewer', harness: 'codex', model: '' },
  { id: 'grok', name: 'Grok', role: 'reviewer', harness: 'cursor', model: '' },
];

const at = (agent: string, stance: string): Position => ({ agent, stance, summary: stance });

describe('consensus line', () => {
  test('agreeing seats are named first and refiners follow', () => {
    expect(consensusLine([at('claude', 'agree'), at('codex', 'revise'), at('grok', 'agree')], agents)).toBe('Agreed by Claude and Grok; Codex refined the fix');
    expect(consensusLine([at('claude', 'agree'), at('codex', 'agree'), at('grok', 'agree')], agents)).toBe('Agreed by Claude, Codex and Grok');
    expect(consensusLine([at('claude', 'revise'), at('codex', 'revise'), at('grok', 'revise')], agents)).toBe('Claude, Codex and Grok refined the fix');
  });

  test('a split shows who holds the finding and who rejects it', () => {
    expect(consensusLine([at('claude', 'disagree'), at('codex', 'revise'), at('grok', 'disagree')], agents)).toBe('Codex holds it; Claude and Grok reject it');
    expect(consensusLine([at('claude', 'agree'), at('codex', 'agree'), at('grok', 'withdraw')], agents)).toBe('Claude and Codex hold it; Grok rejects it');
    expect(consensusLine([at('claude', 'disagree'), at('codex', 'withdraw')], agents)).toBe('Rejected by Claude and Codex');
  });
});

describe('seat words and independent raisers', () => {
  test('stances read as plain words', () => {
    expect(['agree', 'revise', 'disagree', 'withdraw'].map(stanceWord)).toEqual(['agreed', 'refined the fix', 'disagreed', 'withdrew']);
  });

  test('item ids map back to the seat that owns them by prefix', () => {
    expect(alsoRaisedLine(['X4', 'G2'], agents)).toBe('Also raised independently by Codex (X4) and Grok (G2)');
    expect(alsoRaisedLine(['C1'], agents)).toBe('Also raised independently by Claude (C1)');
    expect(alsoRaisedLine(['Z9'], agents)).toBe('Also raised independently by Z9');
  });
});
