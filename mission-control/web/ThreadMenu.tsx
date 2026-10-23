import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

type MenuProps = {
  x: number;
  y: number;
  archived: boolean;
  onRename: () => void;
  onSync: () => void;
  onCopyPrompt: () => void;
  onArchive: () => void;
  onClose: () => void;
};

const MENU_WIDTH = 210;
const MENU_HEIGHT = 168;

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 13 L3.6 10.2 L10.8 3 L13 5.2 L5.8 12.4 Z M9.6 4.2 L11.8 6.4" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

function SyncIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M13 8 A5 5 0 0 0 4.2 4.6 M3 2.8 V5 H5.2 M3 8 A5 5 0 0 0 11.8 11.4 M13 13.2 V11 H10.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10.5 5.5 V4 Q10.5 2.5 9 2.5 H4 Q2.5 2.5 2.5 4 V9 Q2.5 10.5 4 10.5 H5.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function ArchiveGlyph({ restore }: { restore: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d={
          restore
            ? 'M3 6.5 V12.5 Q3 13 3.5 13 H12.5 Q13 13 13 12.5 V6.5 M8 10.5 V3 M5.2 5.6 L8 2.8 L10.8 5.6'
            : 'M2 3.5 H14 V6.5 H2 Z M3 6.5 V12.5 Q3 13 3.5 13 H12.5 Q13 13 13 12.5 V6.5 M6.5 9.2 H9.5'
        }
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Item(props: { icon: ReactNode; label: string; shortcut?: string; onClick: () => void }) {
  return (
    <button className="menu-item" role="menuitem" onClick={props.onClick}>
      {props.icon}
      <span>{props.label}</span>
      {props.shortcut !== undefined ? <span className="menu-shortcut">{props.shortcut}</span> : null}
    </button>
  );
}

export function ThreadMenu(props: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { onClose } = props;
  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);
  const left = Math.min(props.x, window.innerWidth - MENU_WIDTH - 8);
  const top = Math.min(props.y, window.innerHeight - MENU_HEIGHT - 8);
  const act = (run: () => void) => () => {
    onClose();
    run();
  };
  return (
    <div ref={ref} className="context-menu" role="menu" style={{ left, top }}>
      <Item icon={<PencilIcon />} label="Rename" shortcut="R" onClick={act(props.onRename)} />
      <Item icon={<SyncIcon />} label="Sync from chat" onClick={act(props.onSync)} />
      <Item icon={<CopyIcon />} label="Copy prompt" onClick={act(props.onCopyPrompt)} />
      <div className="menu-sep" role="separator" />
      <Item
        icon={<ArchiveGlyph restore={props.archived} />}
        label={props.archived ? 'Unarchive' : 'Archive'}
        shortcut="E"
        onClick={act(props.onArchive)}
      />
    </div>
  );
}
