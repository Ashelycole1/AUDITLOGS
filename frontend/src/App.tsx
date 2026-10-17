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

  const nav = (
    <nav aria-label="Main" className="mt-8 flex flex-col gap-1 px-3">
      {NAV[me.role].map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          className={({ isActive }) =>
            cx(
              "flex min-h-10 items-center gap-3 rounded-lg px-3 text-[0.9375rem] font-medium transition-colors",
              isActive ? "bg-white/10 text-white shadow-[inset_2px_0_0_#6da7ec]" : "text-spine-ink hover:bg-white/5 hover:text-white",
            )
          }
        >
          <Icon name={n.icon} className="size-5 shrink-0" />
          <span className="flex-1">{n.label}</span>
          {n.to === "/approvals" && pending > 0 && <span className="min-w-6 rounded-full bg-[#fdb022] px-1.5 text-center text-xs font-semibold leading-5 text-[#3c2a03]">{pending}</span>}
        </NavLink>
      ))}
    </nav>
  );

  const sidebar = (
    <div className="flex h-full flex-col bg-spine">
      <div className="flex items-center justify-between px-6 pt-6">
        <Wordmark onSpine />
        <button type="button" onClick={() => setMenu(false)} className="grid size-10 place-items-center rounded-lg text-spine-ink hover:bg-white/10 lg:hidden" aria-label="Close menu">
          <Icon name="close" className="size-5" />
        </button>
      </div>
      {nav}
      <div className="mt-auto border-t border-white/10 p-4">
        <div className="flex items-center gap-3 rounded-lg p-2">
          <Avatar name={me.fullName} className="bg-white/10 text-white" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{me.fullName}</p>
            <p className="truncate text-xs text-spine-ink">{ROLE_NAME[me.role]}</p>
          </div>
          <button type="button" onClick={() => logout()} className="grid size-10 place-items-center rounded-lg text-spine-ink hover:bg-white/10 hover:text-white" aria-label="Sign out" title="Sign out">
            <Icon name="logout" className="size-5" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:pl-[17rem]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[17rem] lg:block">{sidebar}</aside>
      {menu && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" className="absolute inset-0 bg-[#0c111d]/60" aria-label="Close menu" onClick={() => setMenu(false)} />
          <div className="relative h-full w-[17rem] max-w-[85vw]">{sidebar}</div>
        </div>
      )}

      <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1320px] items-center gap-3 px-4 sm:px-6 lg:px-8">
          <button type="button" onClick={() => setMenu(true)} className="grid size-10 place-items-center rounded-lg text-muted hover:bg-subtle lg:hidden" aria-label="Open menu">
            <Icon name="menu" className="size-5" />
          </button>
          {canSearch ? (
            <form onSubmit={search} role="search" className="relative w-full max-w-md">
              <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-faint" />
              <input
                type="search"
                aria-label="Search queries"
                placeholder="Search queries by reference or wording"
                className="field !min-h-10 !pl-10 !shadow-none"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              />
            </form>
          ) : <div className="flex-1" />}
          <p className="ml-auto hidden whitespace-nowrap text-sm text-muted md:block">{today}</p>
          <span className="hidden rounded-full bg-lake-wash px-2.5 py-1 text-xs font-semibold text-lake-deep sm:inline">{me.role}</span>
        </div>
      </header>

      <main className="mx-auto max-w-[1320px] px-4 pb-16 pt-8 sm:px-6 lg:px-8">
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
