import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Avatar, cx, Wordmark } from "./components";
import { Icon, type IconName } from "./icons";
import { useStore } from "./storeTypes";
import type { Role } from "./types";
import Login from "./pages/Login";
import DashboardPage from "./pages/Dashboard";
import QueriesPage from "./pages/Queries";
import QueryDetail from "./pages/QueryDetail";
import { ImportPage, BatchesPage } from "./pages/Imports";
import { ApprovalsPage, AuditLogPage, ReportsPage, CompliancePage } from "./pages/Cia";
import { CiaActivityPage } from "./pages/Oversight";
import { UsersPage, SystemPage } from "./pages/Ict";

type NavItem = { to: string; label: string; icon: IconName };

const NAV: Record<Role, NavItem[]> = {
  PIA: [
    { to: "/dashboard", label: "Dashboard", icon: "dashboard" },
    { to: "/import", label: "Import", icon: "upload" },
    { to: "/batches", label: "Batches", icon: "layers" },
    { to: "/queries", label: "All queries", icon: "queries" },
  ],
  CIA: [
    { to: "/dashboard", label: "Dashboard", icon: "dashboard" },
    { to: "/queries", label: "Queries", icon: "queries" },
    { to: "/approvals", label: "Approvals", icon: "approvals" },
    { to: "/audit-log", label: "Audit log", icon: "chain" },
    { to: "/reports", label: "Reports", icon: "reports" },
    { to: "/compliance", label: "Compliance", icon: "compliance" },
  ],
  IA: [
    { to: "/dashboard", label: "Dashboard", icon: "dashboard" },
    { to: "/queries", label: "My queries", icon: "queries" },
  ],
  CEO: [
    { to: "/dashboard", label: "Dashboard", icon: "dashboard" },
    { to: "/cia-activity", label: "CIA activity", icon: "activity" },
  ],
  ICT: [
    { to: "/users", label: "Users", icon: "users" },
    { to: "/system", label: "System", icon: "server" },
  ],
};

const ROLE_NAME: Record<Role, string> = {
  PIA: "Principal Internal Auditor",
  CIA: "Chief Internal Auditor",
  IA: "Internal Auditor",
  CEO: "Chief Executive",
  ICT: "ICT administrator",
};

const IDLE_MINUTES = 30;

function Shell() {
  const { me, ready, logout, state } = useStore();
  const [now, setNow] = useState(Date.now());
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
    const tick = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(tick);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [logout]);

  // Wait for the session check so a reload does not bounce a signed-in person to the sign-in page.
  if (!ready) return <div className="grid min-h-dvh place-items-center text-sm text-muted" role="status">Loading</div>;
  if (!me) return <Navigate to="/login" replace />;
  const pending = state.requests.filter((r) => r.decision === "Pending").length;
  const today = new Intl.DateTimeFormat("en-UG", { timeZone: "Africa/Kampala", weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(now);
  const canSearch = me.role === "PIA" || me.role === "CIA" || me.role === "IA";

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
              ? cx("text-ink", stacked ? "bg-[#20161308]" : "after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-ink")
              : "text-muted hover:text-ink",
          )
        }
      >
        {stacked && <Icon name={n.icon} className="size-[18px] shrink-0 text-faint" />}
        <span className={stacked ? "flex-1" : undefined}>{n.label}</span>
        {n.to === "/approvals" && pending > 0 && <span className="min-w-5 rounded-full bg-lake px-1.5 text-center font-mono text-[0.6875rem] leading-5 text-white">{pending}</span>}
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
              <form onSubmit={search} role="search" className="relative hidden w-56 md:block lg:hidden xl:block 2xl:w-72">
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
            <p className="eyebrow hidden whitespace-nowrap 2xl:block">{today}</p>
            <div className="hidden items-center gap-2.5 border-l border-line pl-3 lg:flex">
              <Avatar name={me.fullName} className="!size-8 !bg-[#ecebe5] !text-xs !text-ink" />
              <div className="leading-tight">
                <p className="whitespace-nowrap text-sm text-ink">{me.fullName}</p>
                <p className="font-mono text-[0.6875rem] uppercase tracking-[0.06em] text-faint" title={ROLE_NAME[me.role]}>{me.role}</p>
              </div>
              <button type="button" onClick={() => logout()} className="ml-1 grid size-9 place-items-center rounded-md text-faint hover:bg-[#20161308] hover:text-ink" aria-label="Sign out" title="Sign out">
                <Icon name="logout" className="size-[18px]" />
              </button>
            </div>
            <button type="button" onClick={() => setMenu((m) => !m)} className="grid size-10 place-items-center rounded-md text-muted hover:bg-[#20161308] lg:hidden" aria-label={menu ? "Close menu" : "Open menu"} aria-expanded={menu}>
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
              <Avatar name={me.fullName} className="!size-8 !bg-[#ecebe5] !text-xs !text-ink" />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-sm">{me.fullName}</p>
                <p className="truncate text-xs text-faint">{ROLE_NAME[me.role]}</p>
              </div>
              <button type="button" onClick={() => logout()} className="inline-flex min-h-9 items-center gap-2 rounded-[5px] border border-rule px-3 text-sm hover:bg-[#20161308]">
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
          <Route element={<RoleRoute roles={["PIA", "CIA", "IA", "CEO"]} />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/overview" element={<Navigate to="/dashboard" replace />} />
          </Route>
          <Route element={<RoleRoute roles={["PIA", "CIA", "IA"]} />}>
            <Route path="/queries" element={<QueriesPage />} />
            <Route path="/queries/:id" element={<QueryDetail />} />
          </Route>
          <Route element={<RoleRoute roles={["PIA"]} />}>
            <Route path="/import" element={<ImportPage />} />
            <Route path="/batches" element={<BatchesPage />} />
          </Route>
          <Route element={<RoleRoute roles={["CIA"]} />}>
            <Route path="/approvals" element={<ApprovalsPage />} />
            <Route path="/audit-log" element={<AuditLogPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/compliance" element={<CompliancePage />} />
          </Route>
          <Route element={<RoleRoute roles={["CEO"]} />}>
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
