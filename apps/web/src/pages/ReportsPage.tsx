import { useState } from "react";
import type { TrialBalanceRow } from "@ledgerlab/shared";
import {
  Badge,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  TBody,
  TD,
  TH,
  THead,
  TR,
  TableWrap,
} from "@ledgerlab/ui";
import { Async } from "../components/states";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { formatDate, money, monthStart, today } from "../lib/format";

/** A titled group of account rows followed by its subtotal. */
function Section({ title, rows, total }: { title: string; rows: TrialBalanceRow[]; total: number }) {
  return (
    <>
      <TR>
        <TD colSpan={2} className="bg-zinc-50 pt-4 text-xs font-medium uppercase tracking-wide text-zinc-500">
          {title}
        </TD>
      </TR>
      {rows.length === 0 ? (
        <TR>
          <TD colSpan={2} muted>
            None
          </TD>
        </TR>
      ) : (
        rows.map((row) => (
          <TR key={row.accountId}>
            <TD>
              <span className="mr-3 font-mono text-xs text-zinc-500">{row.code}</span>
              {row.name}
            </TD>
            <TD numeric>{money(row.balanceMinor)}</TD>
          </TR>
        ))
      )}
      <TR>
        <TD className="font-medium text-zinc-900">Total {title.toLowerCase()}</TD>
        <TD numeric className="font-medium text-zinc-900">
          {money(total)}
        </TD>
      </TR>
    </>
  );
}

function BalanceBadge({ offBy }: { offBy: number }) {
  return (
    <Badge tone={offBy === 0 ? "positive" : "negative"}>
      {offBy === 0 ? "Balanced" : `Off by ${money(Math.abs(offBy))}`}
    </Badge>
  );
}

export function ReportsPage() {
  const [asOf, setAsOf] = useState(today());
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const periodInvalid = Boolean(from && to && from > to);

  const balanceSheet = useAsync(() => api.reporting.balanceSheet(asOf), [asOf]);
  const income = useAsync(
    () =>
      periodInvalid
        ? Promise.reject(new Error("The period start is after its end."))
        : api.reporting.incomeStatement(from, to),
    [from, to, periodInvalid],
  );
  const trial = useAsync(() => api.ledger.trialBalance(asOf), [asOf]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Reports" description="Built from posted entries only. Voided entries never count." />

      <div className="flex flex-wrap items-start gap-4">
        <div className="w-44">
          <Field label="As of" htmlFor="asOf" hint="Balance sheet and trial balance">
            <Input id="asOf" type="date" required value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </Field>
        </div>
        <div className="w-44">
          <Field label="Period from" htmlFor="from" hint="Income statement">
            <Input id="from" type="date" required value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
        </div>
        <div className="w-44">
          <Field
            label="Period to"
            htmlFor="to"
            error={periodInvalid ? "Must be on or after the start" : undefined}
          >
            <Input
              id="to"
              type="date"
              required
              value={to}
              aria-invalid={periodInvalid}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
        </div>
      </div>

      <Card
        title="Balance sheet"
        description={`As of ${formatDate(asOf)}`}
        padded={false}
        actions={
          balanceSheet.data && !balanceSheet.loading ? (
            <BalanceBadge offBy={balanceSheet.data.outOfBalanceMinor} />
          ) : null
        }
      >
        <Async
          loading={balanceSheet.loading}
          error={balanceSheet.error}
          data={balanceSheet.data}
          onRetry={balanceSheet.reload}
        >
          {(data) =>
            data.assets.length + data.liabilities.length === 0 && data.totalEquityMinor === 0 ? (
              <EmptyState
                title="Nothing to report yet"
                description={`No posted entries on or before ${formatDate(asOf)}.`}
              />
            ) : (
              <TableWrap>
                <THead>
                  <TR>
                    <TH>Account</TH>
                    <TH numeric className="w-40">
                      Amount
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  <Section title="Assets" rows={data.assets} total={data.totalAssetsMinor} />
                  <Section title="Liabilities" rows={data.liabilities} total={data.totalLiabilitiesMinor} />
                  <Section title="Equity" rows={data.equity} total={data.totalEquityMinor} />
                  <TR>
                    <TD className="font-semibold text-zinc-900">Total liabilities and equity</TD>
                    <TD numeric className="font-semibold text-zinc-900">
                      {money(data.totalLiabilitiesMinor + data.totalEquityMinor)}
                    </TD>
                  </TR>
                </TBody>
              </TableWrap>
            )
          }
        </Async>
      </Card>

      <Card title="Income statement" description={`${formatDate(from)} to ${formatDate(to)}`} padded={false}>
        <Async loading={income.loading} error={income.error} data={income.data} onRetry={income.reload}>
          {(data) =>
            data.revenue.length + data.expenses.length === 0 ? (
              <EmptyState
                title="No revenue or expenses"
                description="Nothing was posted to income accounts in this period."
              />
            ) : (
              <TableWrap>
                <THead>
                  <TR>
                    <TH>Account</TH>
                    <TH numeric className="w-40">
                      Amount
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  <Section title="Revenue" rows={data.revenue} total={data.totalRevenueMinor} />
                  <Section title="Expenses" rows={data.expenses} total={data.totalExpensesMinor} />
                  <TR>
                    <TD className="font-semibold text-zinc-900">Net income</TD>
                    <TD
                      numeric
                      className={
                        data.netIncomeMinor < 0 ? "font-semibold text-red-700" : "font-semibold text-zinc-900"
                      }
                    >
                      {money(data.netIncomeMinor)}
                    </TD>
                  </TR>
                </TBody>
              </TableWrap>
            )
          }
        </Async>
      </Card>

      <Card
        title="Trial balance"
        description={`As of ${formatDate(asOf)}`}
        padded={false}
        actions={
          trial.data && !trial.loading ? (
            <BalanceBadge offBy={trial.data.totalDebitMinor - trial.data.totalCreditMinor} />
          ) : null
        }
      >
        <Async loading={trial.loading} error={trial.error} data={trial.data} onRetry={trial.reload}>
          {(data) =>
            data.rows.length === 0 ? (
              <EmptyState
                title="Nothing to report yet"
                description={`No posted entries on or before ${formatDate(asOf)}.`}
              />
            ) : (
              <TableWrap>
                <THead>
                  <TR>
                    <TH>Account</TH>
                    <TH numeric className="w-40">
                      Debit
                    </TH>
                    <TH numeric className="w-40">
                      Credit
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {data.rows.map((row) => (
                    <TR key={row.accountId}>
                      <TD>
                        <span className="mr-3 font-mono text-xs text-zinc-500">{row.code}</span>
                        {row.name}
                      </TD>
                      <TD numeric>{row.debitMinor ? money(row.debitMinor) : ""}</TD>
                      <TD numeric>{row.creditMinor ? money(row.creditMinor) : ""}</TD>
                    </TR>
                  ))}
                  <TR>
                    <TD className="font-semibold text-zinc-900">Totals</TD>
                    <TD numeric className="font-semibold text-zinc-900">
                      {money(data.totalDebitMinor)}
                    </TD>
                    <TD numeric className="font-semibold text-zinc-900">
                      {money(data.totalCreditMinor)}
                    </TD>
                  </TR>
                </TBody>
              </TableWrap>
            )
          }
        </Async>
      </Card>
    </div>
  );
}
