import { useEffect, useRef, useState } from 'react';

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

type IndexedRow = { row: Row; index: number };

function collapsedWindow(indexed: IndexedRow[], focusIndex: number): IndexedRow[] {
  if (focusIndex < 0) return indexed.slice(0, COLLAPSED_ROWS);
  const start = Math.min(Math.max(focusIndex - Math.floor(COLLAPSED_ROWS / 2), 0), indexed.length - COLLAPSED_ROWS);
  const window = indexed.slice(start, start + COLLAPSED_ROWS);
  const hunk = indexed.slice(0, focusIndex + 1).reverse().find((item) => item.row.kind === 'hunk');
  return hunk !== undefined && hunk.index < start ? [hunk, ...window] : window;
}

export function Diff({ path, patch, focusLine }: { path: string; patch: string; focusLine?: number }) {
  const [expanded, setExpanded] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLDivElement>(null);
  const { rows, added, removed } = parsePatch(patch);
  const long = rows.length > COLLAPSED_ROWS;
  const focusIndex = focusLine === undefined ? -1 : rows.findIndex((row) => (row.kind === 'add' || row.kind === 'ctx') && row.line === focusLine);
  const indexed = rows.map((row, index) => ({ row, index }));
  const shown = long && !expanded ? collapsedWindow(indexed, focusIndex) : indexed;
  useEffect(() => {
    const body = bodyRef.current;
    const row = focusRef.current;
    if (body === null || row === null) return;
    if (row.offsetTop < body.scrollTop || row.offsetTop + row.offsetHeight > body.scrollTop + body.clientHeight) {
      body.scrollTop = row.offsetTop - body.clientHeight / 2;
    }
  }, []);
  return (
    <div className="diff">
      <div className="diff-head">
        <b>{path}</b>
        <span className="diff-plus">+{added}</span>
        <span className="diff-minus">−{removed}</span>
      </div>
      <div ref={bodyRef} className="diff-body mono">
        {shown.map(({ row, index }) => {
          return row.kind === 'hunk' ? (
            <div key={index} className="hunk">
              {row.text}
            </div>
          ) : (
            <div key={index} ref={index === focusIndex ? focusRef : undefined} className={`dl ${row.kind}${index === focusIndex ? ' focus' : ''}`}>
              <i>{row.line}</i>
              <span>{row.text}</span>
            </div>
          );
        })}
      </div>
      {long ? (
        <button className="diff-toggle" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show less' : `Show all ${rows.length} lines`}
        </button>
      ) : null}
    </div>
  );
}
