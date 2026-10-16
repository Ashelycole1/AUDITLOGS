import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes } from "react-router-dom";
import { cx, Wordmark } from "./components";
import { useStore } from "./store";
import type { Role } from "./types";
import Login from "./pages/Login";
import QueriesPage from "./pages/Queries";
import QueryDetail from "./pages/QueryDetail";
import { ImportPage, BatchesPage } from "./pages/Imports";
import { ApprovalsPage, AuditLogPage, ReportsPage, CompliancePage } from "./pages/Cia";
import { OverviewPage, CiaActivityPage } from "./pages/Oversight";
import { UsersPage, SystemPage } from "./pages/Ict";

const NAV: Record<Role, { to: string; label: string }[]> = {
  PIA: [
    { to: "/import", label: "Import" },
    { to: "/batches", label: "Batches" },
    { to: "/queries", label: "All queries" },
    { to: "/overview", label: "Progress" },
  ],
  CIA: [
    { to: "/queries", label: "Queries" },
    { to: "/approvals", label: "Approvals" },
    { to: "/audit-log", label: "Audit log" },
    { to: "/reports", label: "Reports" },
    { to: "/compliance", label: "Compliance" },
  ],
  IA: [{ to: "/queries", label: "My queries" }],
  CEO: [
    { to: "/overview", label: "Overview" },
    { to: "/cia-activity", label: "CIA activity" },
  ],
  ICT: [
    { to: "/users", label: "Users" },
    { to: "/system", label: "System" },
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
  const { me, logout, state } = useStore();
  const [now, setNow] = useState(Date.now());

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

  if (!me) return <Navigate to="/login" replace />;
  const pending = state.requests.filter((r) => r.decision === "Pending").length;
  const today = new Intl.DateTimeFormat("en-UG", { timeZone: "Africa/Kampala", weekday: "long", day: "numeric", month: "long" }).format(now);

  // The binder: a green spine with an index tab per section. The open tab joins the page it belongs to.
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <aside className="flex shrink-0 flex-col bg-spine text-spine-ink lg:sticky lg:top-0 lg:h-dvh lg:w-60">
        <div className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-6 lg:block lg:px-6 lg:pt-7">
          <Wordmark onSpine />
          <button onClick={() => logout()} className="min-h-10 rounded-md px-2 text-sm font-medium text-sheet hover:bg-white/10 lg:hidden">Sign out</button>
          <p className="hidden text-sm text-spine-ink/75 lg:mt-1.5 lg:block">{today}</p>
        </div>

        <nav aria-label="Main" className="mt-4 flex gap-1 overflow-x-auto px-3 sm:px-5 lg:mt-10 lg:flex-col lg:gap-1.5 lg:overflow-visible lg:pl-4 lg:pr-0">
          {NAV[me.role].map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                cx(
                  "flex min-h-11 shrink-0 items-center justify-between gap-3 px-3.5 text-[0.9375rem] transition-colors",
                  "rounded-t-md lg:rounded-l-md lg:rounded-tr-none",
                  isActive ? "bg-paper font-semibold text-ink" : "text-spine-ink hover:bg-white/8 hover:text-sheet",
                )
              }
            >
              {n.label}
              {n.to === "/approvals" && pending > 0 && (
                <span className="min-w-6 rounded-full bg-warn-wash px-1.5 text-center text-xs font-semibold leading-5 text-warn">{pending}</span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto hidden px-6 pb-7 lg:block">
          <div className="border-t border-white/12 pt-4">
            <p className="font-medium leading-tight text-sheet">{me.fullName}</p>
            <p className="mt-0.5 text-sm text-spine-ink/75">{ROLE_NAME[me.role]}</p>
            <button onClick={() => logout()} className="mt-3 text-sm font-medium text-sheet underline decoration-white/30 underline-offset-4 hover:decoration-white">Sign out</button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 pb-14 pt-7 sm:px-6 lg:px-10 lg:pt-10 xl:px-14">
        <div className="mx-auto max-w-[1180px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function RoleRoute({ roles }: { roles: Role[] }) {
  const { me } = useStore();
  if (!me) return <Navigate to="/login" replace />;
  return roles.includes(me.role) ? <Outlet /> : <Navigate to="/" replace />;
}

function Home() {
  const { me } = useStore();
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
          <Route element={<RoleRoute roles={["PIA", "CEO"]} />}>
            <Route path="/overview" element={<OverviewPage />} />
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
