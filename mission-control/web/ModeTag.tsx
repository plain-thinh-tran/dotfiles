import type { RunMode, RunPr } from '../src/types';

export const MODE_WORD: Record<RunMode, string> = {
  build: 'Build',
  review: 'Review',
  'self-check': 'Pre-merge check',
};

export const MODE_TITLE: Record<RunMode, string> = {
  build: 'Build',
  review: "Review of someone else's PR",
  'self-check': 'Pre-merge check of your PR',
};

export function ModeIcon({ mode }: { mode: RunMode }) {
  return (
    <svg className="mode-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {mode === 'build' ? (
        <path
          d="M3 13 L8 8 M7 4.5 L10 3 L13 6 L11.5 9 Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {mode === 'review' ? (
        <>
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.3" />
          <path d="M10.5 10.5 L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </>
      ) : null}
      {mode === 'self-check' ? (
        <path
          d="M8 2 L13 4 V8 C13 11 10.5 13 8 14 C5.5 13 3 11 3 8 V4 Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      ) : null}
    </svg>
  );
}

export function ModeTag({ mode, pr }: { mode: RunMode; pr: RunPr | null }) {
  return (
    <span className="mode-tag" data-mode={mode} title={MODE_TITLE[mode]}>
      <ModeIcon mode={mode} />
      {MODE_WORD[mode]}
      {mode !== 'build' && pr !== null ? (
        <a className="mode-pr" href={pr.url} target="_blank" rel="noreferrer">
          #{pr.number}
          {pr.author !== '' ? ` by ${pr.author}` : ''}
        </a>
      ) : null}
    </span>
  );
}
