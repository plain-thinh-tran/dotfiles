---
name: avengers
description: Build a change with a council (Claude Opus 5.5 as chair, Codex Sol, Cursor Grok) that meets at the start of design and again to review the finished code, while Haiku 5.5 scouts map the code and Sonnet 5.5 subagents do the coding and testing. Use when the user says /avengers, "assemble the council", or wants Opus to orchestrate a codebase heavy change with cross model design and review.
---

# Avengers

Opus 5.5 is the advisor: orchestrator, architect, council chair and final judge. Sonnet 5.5 subagents are the workers. The council is Opus 5.5, Codex Sol and Cursor Grok 4.6; it meets twice, once when design starts and once when the code is done.

If you are not running on Opus 5.5, tell the user and stop.

## Roles

- Opus (you): frames the work, writes the brief, chairs both meetings, writes the design, specs work packets, integrates, decides every disagreement, reports to the user.
- Council members (Codex Sol, Cursor Grok): read only advisers. They propose and attack designs and review code. They never edit. `council.sh` runs both in parallel.
- Workers (Sonnet 5.5): the Agent tool with `model: "sonnet"`. They execute packets you fully specced; they do not make design calls.
- Scouts (Haiku 5.5): the Agent tool with `model: "haiku"`. Read only lookups that return file:line evidence.

## Meeting Directory

Each run lives in `.context/avengers/<slug>/` inside the target repo. Every meeting artifact is a file there, so any member can read the others' work and the user can audit the trail. `council.sh` points the members at the git toplevel of the meeting dir; when the dir sits elsewhere, set `REPO_DIR` to the repo.

## Steps

1. **Scout.** If the change touches code you have not read, send Haiku scouts to map it in parallel (callers, consumers, tests, sibling patterns), each returning file:line evidence only. Done when you can name every surface the change touches.
2. **Brief.** Write `brief.md`: goal, constraints, surfaces in scope and out of scope, the scout evidence, open questions. Done when a member with no chat context could design from it.
3. **Design meeting.**
   1. Start `~/.claude/skills/avengers/council.sh design <dir>` with `run_in_background`.
   2. While it runs, write your own proposal to `design.opus.md` without opening `design.sol.md` or `design.grok.md`. Blind first, so nobody anchors on the chair. If you have already seen a solution (an existing PR, a fix the user pasted), the Opus seat goes to a fresh Agent with `model: "opus"` given only `brief.md` and the repo.
   3. Read all three. Write `design.md`: the chosen approach, the files and changes, risks, and a Decisions section recording each disagreement, who held which side, and why you ruled the way you did. Take the best idea regardless of who raised it; never merge two approaches into a compromise neither proposed.
   4. Run `council.sh challenge <dir>`. For every objection, change `design.md` or record in Decisions why it does not hold, checked against the code.
   5. Show the user the design in under ten lines, naming any split vote. Then hand the Decisions to Mission Control (see below): split votes as `needs-you` decisions, rulings that shape the design as `key-decision`s. With any `needs-you` todo, wait for the user's answers before Build; otherwise proceed unless they stop you.
4. **Build.** Split `design.md` into work packets and hand them to Sonnet workers, parallel where they do not share files. Keep shared file coordination and tiny or delicate edits yourself. Each packet carries:
   - repo path, exact objective, the `design.md` section it implements
   - files in scope and explicitly out of scope
   - the tests or commands to run and what passing looks like
   - what to return: diff summary, commands run with results, anything unexpected
   - stop conditions: code does not match the packet, a command fails after one retry, or the work needs out of scope files → stop and report, never improvise
5. **Vet.** Treat worker reports as leads. Reopen the cited files, rerun the key tests, and read the full diff against `design.md` before the review meeting. Done when you would sign the diff yourself.
6. **Review meeting.**
   1. Write the change to `diff.patch` (`command git diff origin/<base>... > <dir>/diff.patch`, plus `git diff` if uncommitted). `command` bypasses rtk, which mangles piped git output.
   2. Start `council.sh review <dir>` with `run_in_background`. In parallel, give the Opus seat to a fresh Agent with `model: "opus"` and only `diff.patch`, `design.md` and the repo, writing `review.opus.md`. You specced and vetted the code, so your own review is not independent.
   3. Merge the three reviews into `review.md`. Agreement decides whether a finding is real; severity decides what happens to it.
      - Real: two or more members raise it and the code does not prove it wrong, or one member raises it and you confirm it in the code yourself.
      - Live facts: a finding that rests on live state (Datadog monitors, log volume, AWS, GitHub) gets a read-only check before the verdict, recorded in `review.md`.
      - Action: real blocking and should-fix findings get fixed. Nits are dropped unless all three members raise the same one and it improves the code; list those for the user, never fix them unasked.
      - Record the verdict and reason for every finding in `review.md`.
   4. Hand accepted fixes to Sonnet workers as packets, vet them, and rerun the review meeting once if the fixes changed behaviour. Stop after the second meeting; anything still open goes to the user.
   5. Anything still open after the second meeting goes to Mission Control as `needs-you` decisions, and the report waits for the answers.
7. **Report.** Lead with what shipped and whether the council signed off. Then: split decisions from design and review, findings rejected and why, tests run, anything left open. Link `design.md` and `review.md`.

Model choices for every seat come from the benchmark in `~/.claude/skills/model-bench/results.md`; rerun `/model-bench` when a new model ships.

## Mission Control

Decisions the user owns go through Mission Control, not the chat. Write `<dir>/mc.json`:

- `runId`: `avengers-<slug>`; `skill`: `avengers`; `title`: one line.
- `agents`: the seats that took part, with `role` `orchestrator` for you, `council` for Codex Sol and Cursor Grok.
- `todos`: one per decision, with `id` (`D1`, `D2`, …), `kind` `decision`, `category`, `title`, `question`, `options` (one per side actually argued, `id` and `label`), `positions` (one per seat: `agent`, `stance`, `optionId`, `summary`, `reason`, `evidence` as `path:line`), `recommendation` (`by` your id, `optionId`, `summary` with the ruling's reason), `tradeoffs`, `caveats`.

Push it with `~/.claude/bin/mc push <dir>/mc.json`. Key decisions arrive pre-answered with your ruling, so the user only acts to override. When you must wait, start `~/.claude/bin/mc wait avengers-<slug>` with `run_in_background` and end the turn. When it prints decisions, update `design.md` (record the user's call in Decisions), run `~/.claude/bin/mc resolve avengers-<slug> <id> "<what changed>"` for each, and continue. Run `~/.claude/bin/mc done avengers-<slug>` after the report.

## Council Failures

`council.sh` prints each member's output path or a FAILED line with its log tail. If one member fails, rerun once; if it fails again, hold the meeting with whoever answered and say in the report which seat was empty. If both fail, stop and show the user the logs. A missing Cursor CLI installs with `curl https://cursor.com/install -fsS | bash`.

Models default to `gpt-6-sol` (Codex, needs codex CLI 0.159 or newer; `brew upgrade codex`) and `cursor-grok-4.6-medium` (Cursor, needs `CURSOR_API_KEY`; list ids with `cursor-agent models`). Override with `CODEX_MODEL`, `CODEX_EFFORT` and `CURSOR_MODEL`.

## Benchmark Mode

When the user asks whether the council can match an existing PR, run it against the PR's base without touching the PR:
- Write `brief.md` from the ticket only, never the PR body or diff.
- Use `git worktree add --detach <path> $(git merge-base origin/<base> pr-<N>)` as the repo, with the meeting dir inside it. Remove the worktree and the `pr-<N>` ref when done, after copying the meeting dir out.
- All three design seats are blind; the Opus seat is a fresh Agent (you have seen the PR). Run the challenge round as normal.
- Skip Build and Vet. Review the real PR diff, with `design.md` holding the PR's stated intent.
- Report three lists: what the council matched, what it found that the PR lacks (verified in code), and where the council was wrong.

## When Not To Convene

A one file fix, a config tweak or a question needs no council. Do it directly and say you skipped the meetings.
