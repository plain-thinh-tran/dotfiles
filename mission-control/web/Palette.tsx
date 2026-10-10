import { useState } from 'react';
import type { KeyboardEvent } from 'react';

export type PaletteItem = { id: string; title: string; subtitle: string; shortcut?: string; run: () => void };

const MAX_ITEMS = 12;

function score(item: PaletteItem, query: string): number | null {
  const title = item.title.toLowerCase().indexOf(query);
  if (title === 0) return 0;
  if (title > 0) return 1;
  if (item.subtitle.toLowerCase().includes(query)) return 2;
  return `${item.title} ${item.subtitle}`.toLowerCase().includes(query) ? 3 : null;
}

function rank(items: PaletteItem[], rawQuery: string): PaletteItem[] {
  const query = rawQuery.trim().toLowerCase();
  if (query === '') return items.slice(0, MAX_ITEMS);
  return items
    .map((item, index) => ({ item, index, rank: score(item, query) }))
    .filter((entry): entry is { item: PaletteItem; index: number; rank: number } => entry.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, MAX_ITEMS)
    .map((entry) => entry.item);
}

export function Palette({ items, onClose }: { items: PaletteItem[]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const shown = rank(items, query);
  const current = Math.min(active, Math.max(0, shown.length - 1));

  function run(item: PaletteItem | undefined): void {
    if (item === undefined) return;
    onClose();
    item.run();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current + 1) % Math.max(1, shown.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current - 1 + shown.length) % Math.max(1, shown.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(shown[current]);
    }
  }

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label="Command palette" onMouseDown={(event) => event.stopPropagation()}>
        <input
          autoFocus
          value={query}
          placeholder="Search threads, decisions and actions"
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <div className="palette-list">
          {shown.length === 0 ? <div className="palette-empty">No matches</div> : null}
          {shown.map((item, index) => (
            <div
              key={item.id}
              className="palette-item"
              data-active={index === current}
              onMouseEnter={() => setActive(index)}
              onClick={() => run(item)}
            >
              <span className="palette-title">{item.title}</span>
              {item.subtitle !== '' ? <span className="palette-sub">{item.subtitle}</span> : null}
              {item.shortcut !== undefined ? <kbd>{item.shortcut}</kbd> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
