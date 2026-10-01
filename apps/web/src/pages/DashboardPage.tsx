import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  Stat,
  TBody,
  TD,
  TH,
  THead,
  TR,
  TableWrap,
  buttonClasses,
} from "@ledgerlab/ui";
import { Async } from "../components/states";
import { EntryStatusBadge } from "../components/EntryStatusBadge";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { entryAmount, formatDate, money, monthStart, today } from "../lib/format";

function toneOf(minor: number) {
  return minor > 0 ? "positive" : minor < 0 ? "negative" : "neutral";
}

/** Figures in one surface, separated by hairlines instead of a card each. */
function StatGrid({ children, columns }: { children: ReactNode; columns: string }) {
  return <div className={`grid gap-px bg-zinc-200 ${columns}`}>{children}</div>;
}

function Cell({ children }: { children: ReactNode }) {
  return <div className="bg-white p-5">{children}</div>;
}

export function DashboardPage() {
  const asOf = today();
  const summary = useAsync(() => api.reporting.dashboard(asOf), [asOf]);
  const recent = useAsync(() => api.ledger.listJournalEntries({ page: 1, pageSize: 6 }), []);
  const newEntry = (
    <Link to="/ledger/new" className={buttonClasses({ variant: "primary" })}>
      New journal entry
    </Link>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Dashboard" description={`Position as of ${formatDate(asOf)}`} actions={newEntry} />

      <Async loading={summary.loading} error={summary.error} data={summary.data} onRetry={summary.reload}>
        {(data) => (
          <>
            {data.balanced ? null : (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-sm">
                <p className="font-semibold text-red-800">The ledger is out of balance</p>
                <p className="mt-1 text-red-700">
                  Debits and credits do not match, so the figures below cannot be trusted.{" "}
                  <Link to="/reports" className="font-medium underline">
                    Review the trial balance
                  </Link>
                </p>
              </div>
            )}

            <Card
              title="Financial position"
              padded={false}
              className="overflow-hidden"
              actions={data.balanced ? <Badge tone="positive">In balance</Badge> : null}
            >
              <StatGrid columns="grid-cols-2 lg:grid-cols-4">
                <Cell>
                  <Stat label="Cash" value={money(data.cashMinor)} />
                </Cell>
                <Cell>
                  <Stat label="Total assets" value={money(data.totalAssetsMinor)} />
                </Cell>
                <Cell>
                  <Stat label="Liabilities" value={money(data.totalLiabilitiesMinor)} />
                </Cell>
                <Cell>
                  <Stat label="Equity" value={money(data.totalEquityMinor)} />
                </Cell>
              </StatGrid>
            </Card>

            <Card
              title="This month"
              description={`${formatDate(monthStart())} to ${formatDate(asOf)}`}
              padded={false}
              className="overflow-hidden"
            >
              <StatGrid columns="grid-cols-1 sm:grid-cols-3">
                <Cell>
                  <Stat label="Revenue" value={money(data.revenueMonthToDateMinor)} />
                </Cell>
                <Cell>
                  <Stat label="Expenses" value={money(data.expensesMonthToDateMinor)} />
                </Cell>
                <Cell>
                  <Stat
                    label="Net income"
                    value={money(data.netIncomeMonthToDateMinor)}
                    tone={toneOf(data.netIncomeMonthToDateMinor)}
                  />
                </Cell>
              </StatGrid>
            </Card>
          </>
        )}
      </Async>

      <Card
        title="Recent journal entries"
        padded={false}
        actions={
          <Link to="/ledger" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
            View all
          </Link>
        }
      >
        <Async loading={recent.loading} error={recent.error} data={recent.data} onRetry={recent.reload}>
          {(page) =>
            page.data.length === 0 ? (
              <EmptyState
                title="No journal entries yet"
                description="Entries you post appear here and flow into every report."
                action={newEntry}
              />
            ) : (
              <TableWrap>
                <THead>
                  <TR>
                    <TH className="w-32">Date</TH>
                    <TH>Memo</TH>
                    <TH className="hidden w-32 sm:table-cell">Reference</TH>
                    <TH numeric className="w-36">
                      Amount
                    </TH>
                    <TH className="w-24">Status</TH>
                  </TR>
                </THead>
                <TBody>
                  {page.data.map((entry) => (
                    <TR key={entry.id}>
                      <TD className="whitespace-nowrap">{formatDate(entry.date)}</TD>
                      <TD className="font-medium text-zinc-900">{entry.memo}</TD>
                      <TD muted className="hidden sm:table-cell">
                        {entry.reference ?? "—"}
                      </TD>
                      <TD numeric>{money(entryAmount(entry))}</TD>
                      <TD>
                        <EntryStatusBadge status={entry.status} />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </TableWrap>
            )
          }
        </Async>
      </Card>
    </div>
  );
}
