import { useEffect, useRef, useState } from "react";
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Avatar, cx, ThemeToggle, Wordmark } from "./components";
import { Icon, type IconName } from "./icons";
import { useStore } from "./storeTypes";
import type { Role, User } from "./types";
import { ROLE_NAME } from "./lib/rules";
import Login from "./pages/Login";
import DashboardPage from "./pages/Dashboard";
import QueriesPage from "./pages/Queries";
import QueryDetail from "./pages/QueryDetail";
import { ImportPage, BatchesPage } from "./pages/Imports";
import { ApprovalsPage, AuditLogPage, ReportsPage, CompliancePage } from "./pages/Cia";
import { CiaActivityPage, PersonnelPage } from "./pages/Oversight";
import { UsersPage, SystemPage } from "./pages/Ict";
import NotificationsPage from "./pages/Notifications";
import ProfilePage from "./pages/Profile";

type NavItem = { to: string; label: string; icon: IconName };

// Import and Batches moved from the PIA to the CIA (owner, 2026-10-22).
const AUDITOR_NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { to: "/queries", label: "My queries", icon: "queries" },
];

const NAV: Record<Role, NavItem[]> = {
  PIA: [
    { to: "/dashboard", label: "Dashboard", icon: "dashboard" },
    { to: "/queries", label: "All queries", icon: "queries" },
    { to: "/approvals", label: "Reviews", icon: "approvals" },
  ],
  CIA: [
    { to: "/dashboard", label: "Dashboard", icon: "dashboard" },
    { to: "/queries", label: "Queries", icon: "queries" },
    { to: "/approvals", label: "Approvals", icon: "approvals" },
    // Batch history is reached from the Import page, so the bar keeps room for the profile menu.
    { to: "/import", label: "Import", icon: "upload" },
    { to: "/audit-log", label: "Audit log", icon: "ledger" },
    { to: "/reports", label: "Reports", icon: "reports" },
    { to: "/compliance", label: "Compliance", icon: "compliance" },
  ],
  IA: AUDITOR_NAV,
  SIA: AUDITOR_NAV,
  CEO: [
    { to: "/dashboard", label: "Dashboard", icon: "dashboard" },
    { to: "/personnel", label: "Personnel", icon: "users" },
    { to: "/cia-activity", label: "CIA activity", icon: "activity" },
  ],
  ICT: [
    { to: "/users", label: "Users", icon: "users" },
    { to: "/system", label: "System", icon: "server" },
  ],
};

const IDLE_MINUTES = 30;

function Shell() {
  const { me, ready, logout, state } = useStore();
  const [menu, setMenu] = useState(false);
  const [term, setTerm] = useState("");
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => setMenu(false), [location.pathname]);

  // Session idle timeout (design.md 14). The server enforces the same limit.
  useEffect(() => {
    let timer = window.setTimeout(() => logout("Idle timeout"), IDLE_MINUTES * 60_000);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => logout("Idle timeout"), IDLE_MINUTES * 60_000);
    };
    const events = ["pointerdown", "keydown", "scroll"];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [logout]);

  // Wait for the session check so a reload does not bounce a signed-in person to the sign-in page.
  if (!ready) return <div className="grid min-h-dvh place-items-center text-sm text-muted" role="status">Loading</div>;
  if (!me) return <Navigate to="/login" replace />;
  // What waits on this person: the CIA decides proposals, reassignments and exports; the PIA reviews proposals.
  const pending =
    me.role === "CIA"
      ? [...state.requests, ...state.reassignments, ...state.exports].filter((r) => r.decision === "Pending").length
      : me.role === "PIA"
        ? state.requests.filter((r) => r.decision === "Pending").length
        : 0;
  const unread = state.notifications.filter((n) => n.recipient === me.id && !n.readAt).length;
  const canSearch = me.role === "PIA" || me.role === "CIA" || me.role === "IA" || me.role === "SIA";

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(`/queries?q=${encodeURIComponent(term.trim())}`);
  };

  const links = (stacked: boolean) =>
    NAV[me.role].map((n) => (
      <NavLink
        key={n.to}
        to={n.to}
        className={({ isActive }) =>
          cx(
            "relative flex items-center gap-2 whitespace-nowrap text-sm transition-colors",
            stacked ? "min-h-11 rounded-md px-3" : "h-16 px-1",
            isActive
              ? cx("text-ink", stacked ? "bg-hover" : "after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-ink")
              : "text-muted hover:text-ink",
          )
        }
      >
        {stacked && <Icon name={n.icon} className="size-[18px] shrink-0 text-faint" />}
        <span className={stacked ? "flex-1" : undefined}>{n.label}</span>
        {n.to === "/approvals" && pending > 0 && <span className="min-w-5 rounded-full bg-lake px-1.5 text-center font-mono text-[0.6875rem] leading-5 text-on-accent">{pending}</span>}
      </NavLink>
    ));

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1320px] items-center gap-6 px-4 sm:px-6 lg:px-8">
          <NavLink to="/" aria-label="AuditLogs home" className="shrink-0"><Wordmark /></NavLink>
          <nav aria-label="Main" className="hidden items-center gap-5 lg:flex xl:gap-6">{links(false)}</nav>

          <div className="ml-auto flex items-center gap-3">
            {canSearch && (
              <form onSubmit={search} role="search" className="relative hidden w-56 md:block lg:hidden xl:block">
                <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
                <input
                  type="search"
                  aria-label="Search queries"
                  placeholder="Search queries"
                  className="field !min-h-9 !bg-sheet !py-1.5 !pl-9 !text-sm"
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                />
              </form>
            )}
            <ThemeToggle />
            <NavLink
              to="/notifications"
              className="relative grid size-9 place-items-center rounded-md text-faint hover:bg-hover hover:text-ink"
              aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
              title="Notifications"
            >
              <Icon name="bell" className="size-[18px]" />
              {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-lake px-1 text-center font-mono text-[0.625rem] leading-4 text-on-accent">{unread > 9 ? "9+" : unread}</span>}
            </NavLink>
            <UserMenu me={me} onSignOut={() => logout()} />
            <button type="button" onClick={() => setMenu((m) => !m)} className="grid size-10 place-items-center rounded-md text-muted hover:bg-hover lg:hidden" aria-label={menu ? "Close menu" : "Open menu"} aria-expanded={menu}>
              <Icon name={menu ? "close" : "menu"} className="size-5" />
            </button>
          </div>
        </div>

        {menu && (
          <div className="border-t border-line bg-paper px-4 pb-4 pt-2 sm:px-6 lg:hidden">
            {canSearch && (
              <form onSubmit={search} role="search" className="relative mb-2 md:hidden">
                <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
                <input type="search" aria-label="Search queries" placeholder="Search queries" className="field !bg-sheet !pl-9" value={term} onChange={(e) => setTerm(e.target.value)} />
              </form>
            )}
            <nav aria-label="Main" className="flex flex-col">{links(true)}</nav>
            <div className="mt-3 flex items-center gap-3 border-t border-line pt-3">
              <NavLink to="/profile" className="flex min-w-0 flex-1 items-center gap-3 rounded-md hover:text-lake" aria-label="Your profile">
                <Avatar name={me.fullName} className="!size-8 !bg-chip !text-xs !text-ink" />
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-sm">{me.fullName}</span>
                  <span className="block truncate text-xs text-faint">{ROLE_NAME[me.role]}</span>
                </span>
              </NavLink>
              <button type="button" onClick={() => logout()} className="inline-flex min-h-9 items-center gap-2 rounded-[5px] border border-rule px-3 text-sm hover:bg-hover">
                <Icon name="logout" className="size-4" /> Sign out
              </button>
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-[1320px] px-4 pb-20 pt-10 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}

// Initials (and the name on wide screens) open a menu with the profile and sign-out (owner, 2026-10-23).
function UserMenu({ me, onSignOut }: { me: User; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={box} className="relative hidden border-l border-line pl-3 lg:block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2.5 rounded-md py-1 pl-1 pr-2 hover:bg-hover"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${me.fullName}, ${ROLE_NAME[me.role]}. Open account menu`}
      >
        <Avatar name={me.fullName} className="!size-8 !bg-chip !text-xs !text-ink" />
        <span className="hidden text-left leading-tight 2xl:block">
          <span className="block whitespace-nowrap text-sm text-ink">{me.fullName}</span>
          <span className="block font-mono text-[0.6875rem] uppercase tracking-[0.06em] text-faint">{me.role}</span>
        </span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-[calc(100%+0.5rem)] z-40 w-64 rounded-xl border border-line bg-sheet p-1.5 shadow-[0_12px_24px_-6px_rgba(0,0,0,0.18)]">
          <div className="px-3 py-2.5">
            <p className="truncate text-sm font-medium">{me.fullName}</p>
            <p className="truncate text-xs text-faint">{ROLE_NAME[me.role]}</p>
          </div>
          <div className="my-1 h-px bg-line" />
          <NavLink to="/profile" role="menuitem" className="flex min-h-10 items-center gap-2.5 rounded-md px-3 text-sm hover:bg-hover">
            <Icon name="users" className="size-4 text-faint" /> Your profile
          </NavLink>
          <NavLink to="/notifications" role="menuitem" className="flex min-h-10 items-center gap-2.5 rounded-md px-3 text-sm hover:bg-hover">
            <Icon name="bell" className="size-4 text-faint" /> Notifications
          </NavLink>
          <button type="button" role="menuitem" onClick={onSignOut} className="flex min-h-10 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm hover:bg-hover">
            <Icon name="logout" className="size-4 text-faint" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function RoleRoute({ roles }: { roles: Role[] }) {
  const { me, ready } = useStore();
  if (!ready) return null;
  if (!me) return <Navigate to="/login" replace />;
  return roles.includes(me.role) ? <Outlet /> : <Navigate to="/" replace />;
}

function Home() {
  const { me, ready } = useStore();
  if (!ready) return null;
  if (!me) return <Navigate to="/login" replace />;
  return <Navigate to={NAV[me.role][0].to} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Shell />}>
          <Route index element={<Home />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route element={<RoleRoute roles={["PIA", "CIA", "IA", "SIA", "CEO"]} />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/overview" element={<Navigate to="/dashboard" replace />} />
          </Route>
          <Route element={<RoleRoute roles={["PIA", "CIA", "IA", "SIA"]} />}>
            <Route path="/queries" element={<QueriesPage />} />
            <Route path="/queries/:id" element={<QueryDetail />} />
          </Route>
          <Route element={<RoleRoute roles={["PIA", "CIA"]} />}>
            <Route path="/approvals" element={<ApprovalsPage />} />
          </Route>
          <Route element={<RoleRoute roles={["CIA"]} />}>
            <Route path="/import" element={<ImportPage />} />
            <Route path="/batches" element={<BatchesPage />} />
            <Route path="/audit-log" element={<AuditLogPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/compliance" element={<CompliancePage />} />
          </Route>
          <Route element={<RoleRoute roles={["CEO"]} />}>
            <Route path="/personnel" element={<PersonnelPage />} />
            <Route path="/cia-activity" element={<CiaActivityPage />} />
          </Route>
          <Route element={<RoleRoute roles={["ICT"]} />}>
            <Route path="/users" element={<UsersPage />} />
            <Route path="/system" element={<SystemPage />} />
          </Route>
          <Route path="*" element={<Home />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
