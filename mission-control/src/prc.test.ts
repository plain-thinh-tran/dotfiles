import { describe, expect, test } from 'bun:test';
import { consensusSeverity, findingTodo, findingTodos, modeFor, resolveLogin, runIdFor, stripRefs, type TallyItem } from './prc';

const PATCH = `diff --git a/terraform/grouper.tf b/terraform/grouper.tf
--- a/terraform/grouper.tf
+++ b/terraform/grouper.tf
@@ -10,3 +10,4 @@ module "grouper_queue"
   name = "ingest"
-  tags = local.tags
+  tags = merge(local.tags, {})
   fifo = false
`;

const seat = (stance: 'agree' | 'revise' | 'disagree', severity: string) => ({
  stance,
  severity,
  reason: `${stance} because`,
  evidence: 'a.tf:1; b.tf:2',
  revised_fix: null,
});

const AGREED: TallyItem = {
  id: 'F1',
  owner: 'claude',
  severity: 'regression',
  title: 'Tags dropped',
  location: 'terraform/grouper.tf:12',
  failure: 'The tags block drops the Vanta label.',
  fix: 'Merge the tags.',
  evidence: 'Reproduced with tofu plan on dev',
  status: 'agreed',
  claude: seat('agree', 'regression'),
};

const CONTESTED: TallyItem = {
  id: 'F2',
  owner: 'codex',
  severity: 'worth-knowing',
  title: 'Fallback to the primary address',
  location: 'src/other.ts:5',
  failure: 'It falls back to the primary address.',
  fix: 'Add a comment.',
  confidence: 'low',
  status: 'contested',
  claude: seat('agree', 'worth-knowing'),
  codex: seat('disagree', 'worth-knowing'),
  grok: seat('revise', 'refactor'),
};

describe('findingTodo', () => {
  test('an agreed item becomes a finding with its explanation, severity, verification and diff', () => {
    const todo = findingTodo(AGREED, PATCH, 'https://github.com/o/r/pull/9');
    expect(todo.kind).toBe('finding');
    expect(todo.category).toBe('needs-you');
    expect(todo.question).toBe('The tags block drops the Vanta label.\n\nFix: Merge the tags.');
    expect(todo.severity).toBe('regression');
    expect(todo.verification).toBe('Reproduced with tofu plan on dev');
    expect(todo.positions).toEqual([]);
    expect(todo.evidence).toEqual([{ ref: 'terraform/grouper.tf:12' }]);
    expect(todo.links).toEqual([{ label: 'Pull request', url: 'https://github.com/o/r/pull/9' }]);
    expect(todo.diffs).toHaveLength(1);
    expect(todo.draftComment).toBe('');
    expect(todo.suggestedQuestions).toEqual([]);
  });

  test('a contested item keeps every reviewer position without option ids', () => {
    const todo = findingTodo(CONTESTED, PATCH);
    expect(todo.positions.map((position) => position.agent)).toEqual(['claude', 'codex', 'grok']);
    expect(todo.positions.every((position) => !('optionId' in position))).toBe(true);
    expect(todo.verification).toBeUndefined();
    expect(todo.caveats).toEqual(['Raised with low confidence']);
    expect(todo.links).toEqual([]);
    expect(todo.diffs).toEqual([]);
  });
});

describe('findingTodos', () => {
  test('emits agreed and contested items of any severity, contested first, and skips dropped ones', () => {
    const dropped: TallyItem = { ...AGREED, id: 'F3', status: 'dropped' };
    const refactor: TallyItem = { ...AGREED, id: 'F4', severity: 'refactor' };
    expect(findingTodos([AGREED, dropped, CONTESTED, refactor], PATCH).map((todo) => todo.id)).toEqual(['F2', 'F1', 'F4']);
  });
});

describe('mode', () => {
  test('a PR authored by Thinh is a self-check, anything else a review', () => {
    expect(modeFor('plain-thinh-tran', 'plain-thinh-tran')).toBe('self-check');
    expect(modeFor('someone-else', 'plain-thinh-tran')).toBe('review');
    expect(modeFor(undefined, 'plain-thinh-tran')).toBe('review');
    expect(modeFor('someone-else', null)).toBe('review');
  });

  test('MC_GH_LOGIN wins over the lookup and a failed lookup gives null', () => {
    expect(resolveLogin({ MC_GH_LOGIN: 'me' }, () => 'looked-up')).toBe('me');
    expect(resolveLogin({}, () => 'looked-up')).toBe('looked-up');
    expect(resolveLogin({ MC_GH_LOGIN: '' }, () => null)).toBeNull();
  });
});

describe('ref prefixes, run ids and severity consensus', () => {
  test('git ref prefixes are stripped from locations, verification and reviewer evidence', () => {
    expect(stripRefs('pr-11506:terraform/a.tf:12')).toBe('terraform/a.tf:12');
    expect(stripRefs('origin/main:src/b.ts:3, pr-9:src/c.ts:4')).toBe('src/b.ts:3, src/c.ts:4');
    expect(stripRefs('see (origin/feature/x:lib/d.ts:1); plain.ts:2')).toBe('see (lib/d.ts:1); plain.ts:2');
    expect(stripRefs('src/keep.ts:5 and a-pr-1:thing')).toBe('src/keep.ts:5 and a-pr-1:thing');
    const todo = findingTodo(
      {
        ...CONTESTED,
        location: 'pr-9:src/other.ts:5',
        evidence: 'origin/main:docs/x.md:1; pr-9:docs/y.md:2',
        claude: { ...seat('agree', 'worth-knowing'), evidence: 'pr-9:src/a.ts:1; origin/main:src/b.ts:2' },
      },
      '',
    );
    expect(todo.evidence).toEqual([{ ref: 'src/other.ts:5' }]);
    expect(todo.verification).toBe('docs/x.md:1; docs/y.md:2');
    expect(todo.positions[0]?.evidence).toEqual(['src/a.ts:1', 'src/b.ts:2']);
  });

  test('the run id comes from the pull request url, even for a relative context path', () => {
    expect(runIdFor('https://github.com/team-plain/services/pull/11506', '.context/prod-ready-check/pr-11506')).toBe('prc-services-11506');
    expect(runIdFor('https://github.com/team-plain/infrastructure/pull/584', '/x/y/z/w/pr-1', 1)).toBe('prc-infrastructure-584');
  });

  test('without a url the run id falls back to the directory layout', () => {
    expect(runIdFor(undefined, '/ws/services/belgrade/.context/prod-ready-check/pr-77')).toBe('prc-services-77');
    expect(runIdFor(undefined, '/ws/services/belgrade/.context/prod-ready-check/pr-77', 12)).toBe('prc-services-12');
  });

  test('severity is the most common label among agree and revise stances, ties go to the owner label', () => {
    const base = { ...CONTESTED, severity: 'worth-knowing', owner: 'claude' as const };
    expect(consensusSeverity({ ...base, claude: seat('agree', 'regression'), codex: seat('agree', 'regression'), grok: seat('agree', 'worth-knowing') })).toBe('regression');
    expect(consensusSeverity({ ...base, claude: seat('agree', 'worth-knowing'), codex: seat('agree', 'regression'), grok: undefined })).toBe('worth-knowing');
    expect(consensusSeverity({ ...base, claude: seat('agree', 'breaking'), codex: seat('revise', 'regression'), grok: undefined })).toBe('breaking');
    expect(consensusSeverity({ ...base, claude: seat('disagree', 'breaking'), codex: seat('agree', 'refactor'), grok: seat('revise', 'refactor') })).toBe('refactor');
    expect(consensusSeverity({ ...base, claude: seat('disagree', 'breaking'), codex: undefined, grok: undefined })).toBe('worth-knowing');
  });
});
