export type SnackState = { id: number; text: string; undoable: boolean };

export function Snackbar({ snack, onUndo }: { snack: SnackState; onUndo: () => void }) {
  return (
    <div className="snackbar" role="status">
      <svg key={snack.id} className="snack-ring" viewBox="0 0 18 18" aria-hidden="true">
        <circle className="snack-bg" cx="9" cy="9" r="7" />
        <circle className="snack-fg" cx="9" cy="9" r="7" />
      </svg>
      <span>{snack.text}</span>
      {snack.undoable ? (
        <button className="snack-undo" onClick={onUndo}>
          UNDO
        </button>
      ) : null}
    </div>
  );
}
