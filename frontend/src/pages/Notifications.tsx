import { useNavigate } from "react-router-dom";
import { Button, Empty, PageHeader, Panel, cx } from "../components";
import { fmtDateTime } from "../lib/rules";
import { useMe, useStore } from "../storeTypes";
import type { Notification } from "../types";

// In-app notifications (owner, 2026-10-22). Each one names a query or a request and links to it;
// the details stay on that page, behind its own access checks.
export default function NotificationsPage() {
  const me = useMe();
  const { state, markRead, markAllRead } = useStore();
  const navigate = useNavigate();
  const mine = state.notifications.filter((n) => n.recipient === me.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const unread = mine.filter((n) => !n.readAt).length;

  const open = async (n: Notification) => {
    await markRead(n.id);
    if (n.link) navigate(n.link);
  };

  return (
    <>
      <PageHeader
        title="Notifications"
        lede={unread ? `${unread} unread. Open one to see the query or request it is about.` : "You are up to date."}
        actions={unread > 0 && <Button kind="secondary" onClick={() => markAllRead()}>Mark all as read</Button>}
      />
      <Panel>
        {mine.length ? (
          <ul className="divide-y divide-line">
            {mine.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => open(n)} className="flex w-full items-start gap-3 py-3.5 text-left first:pt-0 hover:text-lake">
                  <span className={cx("mt-2 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-lake")} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className={cx("block", !n.readAt && "font-medium")}>{n.headline}</span>
                    {n.body && <span className="block text-sm text-muted">{n.body}</span>}
                    <span className="block text-[0.8125rem] text-faint">
                      {fmtDateTime(n.createdAt)}
                      {!n.readAt && <span className="sr-only">, unread</span>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="No notifications yet">Assignments, returns, approvals and comments that concern you appear here.</Empty>
        )}
      </Panel>
    </>
  );
}
