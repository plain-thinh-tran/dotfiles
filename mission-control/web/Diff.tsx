import { useState } from 'react';

type Row = { kind: 'hunk' | 'ctx' | 'add' | 'del'; line: number | null; text: string };

const COLLAPSED_ROWS = 40;

function parsePatch(patch: string): { rows: Row[]; added: number; removed: number } {
  const rows: Row[] = [];
  let oldLine = 0;
  let newLine = 0;
  const lines = patch.split('\n');
  lines.forEach((line, index) => {
    if (line.startsWith('@@')) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
      oldLine = Number(match?.[1] ?? 0);
      newLine = Number(match?.[2] ?? 0);
      rows.push({ kind: 'hunk', line: null, text: line });
    } else if (line.startsWith('\\') || (line === '' && index === lines.length - 1)) {
      return;
    } else if (line.startsWith('+')) {
      rows.push({ kind: 'add', line: newLine++, text: line.slice(1) });
    } else if (line.startsWith('-')) {
      rows.push({ kind: 'del', line: oldLine++, text: line.slice(1) });
    } else {
      oldLine += 1;
      rows.push({ kind: 'ctx', line: newLine++, text: line.slice(1) });
    }
  });
  return {
    rows,
    added: rows.filter((row) => row.kind === 'add').length,
    removed: rows.filter((row) => row.kind === 'del').length,
  };
}

export function Diff({ path, patch }: { path: string; patch: string }) {
  const [expanded, setExpanded] = useState(false);
  const { rows, added, removed } = parsePatch(patch);
  const long = rows.length > COLLAPSED_ROWS;
  const shown = long && !expanded ? rows.slice(0, COLLAPSED_ROWS) : rows;
  return (
    <div className="diff">
      <div className="diff-head">
        <b>{path}</b>
        <span className="diff-plus">+{added}</span>
        <span className="diff-minus">−{removed}</span>
      </div>
      <div className="diff-body mono">
        {shown.map((row, index) =>
          row.kind === 'hunk' ? (
            <div key={index} className="hunk">
              {row.text}
            </div>
          ) : (
            <div key={index} className={`dl ${row.kind}`}>
              <i>{row.line}</i>
              <span>{row.text}</span>
            </div>
          ),
        )}
      </div>
      {long ? (
        <button className="diff-toggle" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show less' : `Show all ${rows.length} lines`}
        </button>
      ) : null}
    </div>
  );
}
