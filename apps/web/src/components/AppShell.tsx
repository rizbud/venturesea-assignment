import { NavLink, Outlet } from "react-router-dom";
import { cn } from "@ledgerlab/ui";
import { useAsync } from "../lib/useAsync";
import { api } from "../lib/api";

const NAV = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/ledger", label: "Ledger", end: false },
  { to: "/accounts", label: "Accounts", end: true },
  { to: "/reports", label: "Reports", end: true },
];

function ServiceStatus() {
  const { data, error } = useAsync(() => api.ledger.health(), []);
  const ok = Boolean(data) && !error;
  return (
    <div className="flex items-center gap-2 px-4 py-3 text-xs text-zinc-500">
      <span className={cn("size-2 rounded-full", ok ? "bg-emerald-500" : "bg-red-500")} aria-hidden />
      <span>{ok ? "Ledger connected" : "Ledger service unreachable"}</span>
    </div>
  );
}

function navClass({ isActive }: { isActive: boolean }): string {
  return cn(
    "rounded-md px-2.5 py-2 text-sm whitespace-nowrap transition-colors",
    isActive ? "bg-zinc-100 font-medium text-zinc-900" : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900",
  );
}

function NavLinks() {
  return NAV.map(({ to, label, end }) => (
    <NavLink key={to} to={to} end={end} className={navClass}>
      {label}
    </NavLink>
  ));
}

export function AppShell() {
  return (
    <div className="flex min-h-full">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-zinc-200 bg-white md:flex">
        <div className="flex h-14 items-center px-4">
          <span className="text-sm font-semibold tracking-tight text-zinc-900">LedgerLab</span>
        </div>
        <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5 px-2">
          <NavLinks />
        </nav>
        <div className="border-t border-zinc-200">
          <ServiceStatus />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-zinc-200 bg-white md:hidden">
          <div className="flex h-12 items-center px-4">
            <span className="text-sm font-semibold text-zinc-900">LedgerLab</span>
          </div>
          <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-2 pb-2">
            <NavLinks />
          </nav>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
