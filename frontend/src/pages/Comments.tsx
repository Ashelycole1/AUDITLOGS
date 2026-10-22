import { useEffect, useRef, useState } from "react";
import { Button, Empty, Notice, Ref, cx } from "../components";
import { canWorkRole, fmtDateTime } from "../lib/rules";
import { useMe, useStore } from "../storeTypes";
import type { Query } from "../types";

// Comments by anyone in the audit chain who can see the query, and by the CEO (owner, 2026-10-22).
// They change nothing on the query; the auditor who holds it is notified.
export function CommentThread({ q }: { q: Query }) {
  const me = useMe();
  const { state, userName, addComment } = useStore();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = state.comments.filter((c) => c.queryId === q.id);
  const canWrite = canWorkRole(me.role) || me.role === "CEO";

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await addComment(q.id, body);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setBody("");
    setError(null);
  };

  return (
    <>
      {rows.length ? (
        <ul className="space-y-4">
          {rows.map((c) => (
            <li key={c.id} className="text-sm">
              <p>
                <span className="font-medium">{userName(c.author)}</span>
                <span className="ml-1.5 rounded bg-chip px-1.5 py-px font-mono text-[0.6875rem] text-muted">{c.authorRole}</span>
                <span className="text-muted">, {fmtDateTime(c.createdAt)}</span>
              </p>
              <p className="mt-1 max-w-[68ch] text-[0.9375rem] leading-relaxed">{c.body}</p>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="No comments yet">{canWrite ? undefined : "Comments on this query appear here."}</Empty>
      )}
      {canWrite && (
        <form onSubmit={save} className={cx("glass-inset rounded-md p-4", rows.length ? "mt-5" : "mt-3")}>
          <textarea
            className="field min-h-20"
            aria-label="Comment"
            placeholder="Your comment. The auditor holding this query is notified."
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          {error && <div className="mt-2"><Notice tone="error">{error}</Notice></div>}
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-[0.8125rem] text-faint">Saved comments cannot be edited.</p>
            <Button kind="primary" type="submit" disabled={busy}>Add comment</Button>
          </div>
        </form>
      )}
    </>
  );
}

/** The comment thread in a dialog, for pages that list queries without opening them (CEO). */
export function CommentDialog({ q, onClose }: { q: Query | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { loadComments } = useStore();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (q && !d.open) {
      loadComments(q.id);
      d.showModal();
    }
    if (!q && d.open) d.close();
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(36rem,calc(100vw-2rem))] rounded-xl bg-transparent p-0 text-ink backdrop:bg-[#130d0b]/55 backdrop:backdrop-blur-[2px]"
    >
      {q && (
        <div className="max-h-[85dvh] overflow-y-auto rounded-xl border border-line bg-sheet p-6 shadow-[0_20px_24px_-4px_rgba(0,0,0,0.12),0_8px_8px_-4px_rgba(0,0,0,0.05)]">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Ref>{q.reference}</Ref>
              <h2 className="mt-0.5 text-lg font-medium leading-snug tracking-[-0.01em]">{q.title}</h2>
            </div>
            <Button kind="quiet" onClick={onClose} aria-label="Close">Close</Button>
          </div>
          <CommentThread q={q} />
        </div>
      )}
    </dialog>
  );
}
