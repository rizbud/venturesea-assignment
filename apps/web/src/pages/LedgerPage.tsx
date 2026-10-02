import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import type { EntryStatus, JournalEntry } from "@ledgerlab/shared";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  TBody,
  TD,
  TH,
  THead,
  TR,
  TableWrap,
  buttonClasses,
  cn,
} from "@ledgerlab/ui";
import { Async } from "../components/states";
import { EntryStatusBadge } from "../components/EntryStatusBadge";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { entryAmount, formatDate, minor, money } from "../lib/format";

const PAGE_SIZE = 20;

const CSV_HEADER = ["date", "reference", "status", "memo", "account_code", "account_name", "amount"];

// Quoted, with a leading ' on text that a spreadsheet would run as a formula.
function csvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function downloadEntriesCsv(entries: readonly JournalEntry[]): void {
  const rows = entries.flatMap((entry) =>
    entry.lines.map((line) =>
      [
        ...[
          entry.date,
          entry.reference ?? "",
          entry.status,
          entry.memo,
          line.accountCode ?? "",
          line.accountName ?? line.accountId,
        ].map(csvField),
        // Signed decimal from integer minor units; never escaped, a credit starts with "-".
        `"${minor(line.amountMinor)}"`,
      ].join(","),
    ),
  );
  const csv = [CSV_HEADER.map(csvField).join(","), ...rows].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "ledger.csv";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

interface Filters {
  status: "" | EntryStatus;
  from: string;
  to: string;
}

const NO_FILTERS: Filters = { status: "", from: "", to: "" };

export function LedgerPage() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [expanded, setExpanded] = useState<string | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | undefined>(undefined);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [exporting, setExporting] = useState(false);

  const rangeInvalid = Boolean(filters.from && filters.to && filters.from > filters.to);
  const filtered = filters.status !== "" || filters.from !== "" || filters.to !== "";
  const { data, loading, error, reload } = useAsync(
    () =>
      rangeInvalid
        ? Promise.reject(new Error("The start date is after the end date."))
        : api.ledger.listJournalEntries({
            page,
            pageSize: PAGE_SIZE,
            status: filters.status || undefined,
            from: filters.from || undefined,
            to: filters.to || undefined,
          }),
    [page, filters.status, filters.from, filters.to, rangeInvalid],
  );

  function updateFilters(patch: Partial<Filters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  }

  // Every entry matching the filters, not just this page (the API caps a page at 200).
  async function exportCsv() {
    setActionError(undefined);
    setExporting(true);
    try {
      const all: JournalEntry[] = [];
      for (let p = 1; ; p++) {
        const result = await api.ledger.listJournalEntries({
          page: p,
          pageSize: 200,
          status: filters.status || undefined,
          from: filters.from || undefined,
          to: filters.to || undefined,
        });
        all.push(...result.data);
        if (result.data.length === 0 || all.length >= result.total) break;
      }
      downloadEntriesCsv(all);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "The export failed.");
    } finally {
      setExporting(false);
    }
  }

  async function voidEntry(id: string, memo: string) {
    if (!window.confirm(`Void "${memo}"? It will stop counting in every report. This cannot be undone.`)) {
      return;
    }
    setBusyId(id);
    setActionError(undefined);
    try {
      await api.ledger.voidJournalEntry(id);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not void the entry.");
    } finally {
      setBusyId(undefined);
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="General ledger"
        description="Journal entries, newest first."
        actions={
          <>
            <Button
              variant="secondary"
              disabled={exporting || data === undefined || data.data.length === 0}
              onClick={() => void exportCsv()}
            >
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
            <Link to="/ledger/new" className={buttonClasses({ variant: "primary" })}>
              New journal entry
            </Link>
          </>
        }
      />

      <div className="flex flex-wrap items-end gap-4">
        <div className="w-36">
          <Field label="Status" htmlFor="status">
            <Select
              id="status"
              value={filters.status}
              onChange={(e) => updateFilters({ status: e.target.value as Filters["status"] })}
            >
              <option value="">All</option>
              <option value="POSTED">Posted</option>
              <option value="VOID">Void</option>
            </Select>
          </Field>
        </div>
        <div className="w-44">
          <Field label="From" htmlFor="from">
            <Input
              id="from"
              type="date"
              value={filters.from}
              onChange={(e) => updateFilters({ from: e.target.value })}
            />
          </Field>
        </div>
        <div className="w-44">
          <Field
            label="To"
            htmlFor="to"
            error={rangeInvalid ? "Must be on or after the start date" : undefined}
          >
            <Input
              id="to"
              type="date"
              value={filters.to}
              aria-invalid={rangeInvalid}
              onChange={(e) => updateFilters({ to: e.target.value })}
            />
          </Field>
        </div>
        {filtered ? (
          <Button variant="ghost" onClick={() => updateFilters(NO_FILTERS)}>
            Clear filters
          </Button>
        ) : null}
      </div>

      {actionError ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {actionError}
        </p>
      ) : null}

      <Card padded={false}>
        {rangeInvalid ? (
          <EmptyState title="Fix the date range" description="The start date is after the end date." />
        ) : (
          <Async loading={loading} error={error} data={data} onRetry={reload}>
            {(result) =>
              result.data.length === 0 ? (
                filtered ? (
                  <EmptyState
                    title="No entries match these filters"
                    action={<Button onClick={() => updateFilters(NO_FILTERS)}>Clear filters</Button>}
                  />
                ) : (
                  <EmptyState
                    title="No journal entries yet"
                    description="Post your first entry to start the ledger."
                    action={
                      <Link to="/ledger/new" className={buttonClasses({ variant: "primary" })}>
                        New journal entry
                      </Link>
                    }
                  />
                )
              ) : (
                <>
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
                        <TH className="w-20">
                          <span className="sr-only">Actions</span>
                        </TH>
                      </TR>
                    </THead>
                    <TBody>
                      {result.data.map((entry) => {
                        const isOpen = expanded === entry.id;
                        const isVoid = entry.status === "VOID";
                        const detailId = `lines-${entry.id}`;
                        return (
                          <Fragment key={entry.id}>
                            <TR>
                              <TD className="whitespace-nowrap">{formatDate(entry.date)}</TD>
                              <TD>
                                <button
                                  type="button"
                                  aria-expanded={isOpen}
                                  aria-controls={detailId}
                                  onClick={() => setExpanded(isOpen ? undefined : entry.id)}
                                  className={cn(
                                    "rounded-sm text-left font-medium hover:text-indigo-700",
                                    isVoid ? "text-zinc-500 line-through" : "text-zinc-900",
                                  )}
                                >
                                  {entry.memo}
                                </button>
                                <span className="ml-2 text-xs text-zinc-500">{entry.lines.length} lines</span>
                              </TD>
                              <TD muted className="hidden sm:table-cell">
                                {entry.reference ?? "—"}
                              </TD>
                              <TD numeric muted={isVoid}>
                                {money(entryAmount(entry))}
                              </TD>
                              <TD>
                                <EntryStatusBadge status={entry.status} />
                              </TD>
                              <TD className="text-right">
                                {entry.status === "POSTED" ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    loading={busyId === entry.id}
                                    aria-label={`Void ${entry.memo}`}
                                    onClick={() => void voidEntry(entry.id, entry.memo)}
                                  >
                                    Void
                                  </Button>
                                ) : null}
                              </TD>
                            </TR>
                            {isOpen ? (
                              <TR id={detailId} className="bg-zinc-50">
                                <TD colSpan={6} className="px-4 py-3">
                                  <table className="w-full text-sm">
                                    <caption className="sr-only">Lines of {entry.memo}</caption>
                                    <thead>
                                      <tr className="text-xs uppercase tracking-wide text-zinc-500">
                                        <th scope="col" className="py-1 text-left font-medium">
                                          Account
                                        </th>
                                        <th scope="col" className="w-36 py-1 text-right font-medium">
                                          Debit
                                        </th>
                                        <th scope="col" className="w-36 py-1 text-right font-medium">
                                          Credit
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {entry.lines.map((line) => (
                                        <tr key={line.id} className="border-t border-zinc-200">
                                          <td className="py-1.5 text-zinc-700">
                                            <span className="mr-2 font-mono text-xs text-zinc-500">
                                              {line.accountCode ?? "----"}
                                            </span>
                                            {line.accountName ?? line.accountId}
                                          </td>
                                          <td className="py-1.5 text-right tabular-nums text-zinc-800">
                                            {line.amountMinor > 0 ? money(line.amountMinor) : ""}
                                          </td>
                                          <td className="py-1.5 text-right tabular-nums text-zinc-800">
                                            {line.amountMinor < 0 ? money(-line.amountMinor) : ""}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </TD>
                              </TR>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </TBody>
                  </TableWrap>
                  <div className="flex items-center justify-between border-t border-zinc-200 px-4 py-3 text-sm text-zinc-600">
                    <span>
                      Page {result.page} of {totalPages} · {result.total} entries
                    </span>
                    <div className="flex gap-2">
                      <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                        Previous
                      </Button>
                      <Button size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                        Next
                      </Button>
                    </div>
                  </div>
                </>
              )
            }
          </Async>
        )}
      </Card>
    </div>
  );
}
