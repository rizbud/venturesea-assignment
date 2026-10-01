import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { MoneyError, isBalanced, parseAmountToMinor } from "@ledgerlab/shared";
import {
  Badge,
  Button,
  Card,
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
} from "@ledgerlab/ui";
import { Async } from "../components/states";
import { api, ApiError } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { money, today } from "../lib/format";

interface DraftLine {
  key: number;
  accountId: string;
  amount: string;
  side: "DEBIT" | "CREDIT";
  touched: boolean;
}

let lineKey = 0;
const blankLine = (side: DraftLine["side"] = "DEBIT"): DraftLine => ({
  key: lineKey++,
  accountId: "",
  amount: "",
  side,
  touched: false,
});

/** Parse one amount field into signed minor units, or explain what is wrong with it. */
function parseLine(line: DraftLine): { minor?: number; error?: string } {
  if (!line.amount.trim()) return {};
  let value: number;
  try {
    value = parseAmountToMinor(line.amount);
  } catch (err) {
    if (err instanceof MoneyError && err.message.includes("decimals")) {
      return { error: "Use at most 2 decimal places." };
    }
    return { error: "Enter a number, for example 1,250.00." };
  }
  if (value < 0) return { error: "Enter a positive amount and choose Debit or Credit." };
  if (value === 0) return { error: "Amount must be greater than zero." };
  if (!Number.isSafeInteger(value)) return { error: "Amount is too large." };
  return { minor: line.side === "DEBIT" ? value : -value };
}

export function NewEntryPage() {
  const navigate = useNavigate();
  const accounts = useAsync(() => api.ledger.listAccounts(), []);
  const [date, setDate] = useState(today());
  const [memo, setMemo] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([blankLine("DEBIT"), blankLine("CREDIT")]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  function updateLine(key: number, patch: Partial<DraftLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function removeLine(key: number) {
    setLines((current) => (current.length <= 2 ? current : current.filter((line) => line.key !== key)));
  }

  const parsed = lines.map(parseLine);
  const amounts = parsed.map((p) => p.minor);
  const complete = amounts.every((value) => value !== undefined) && lines.every((l) => l.accountId);
  const debits = amounts.reduce<number>((sum, v) => sum + (v && v > 0 ? v : 0), 0);
  const credits = amounts.reduce<number>((sum, v) => sum + (v && v < 0 ? -v : 0), 0);
  const balanced = complete && isBalanced(amounts as number[]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setLines((current) => current.map((line) => ({ ...line, touched: true })));
    if (!complete) {
      setError("Every line needs an account and a valid amount.");
      return;
    }
    if (!balanced) {
      setError(`Debits and credits must be equal. They differ by ${money(Math.abs(debits - credits))}.`);
      return;
    }
    setSubmitting(true);
    try {
      await api.ledger.createJournalEntry({
        date,
        memo,
        reference: reference.trim() || undefined,
        lines: lines.map((line, i) => ({ accountId: line.accountId, amountMinor: amounts[i]! })),
      });
      navigate("/ledger");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not post the entry. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New journal entry"
        description="Debits must equal credits before the entry can be posted."
      />

      <Async loading={accounts.loading} error={accounts.error} data={accounts.data} onRetry={accounts.reload}>
        {(accountList) => {
          const active = accountList.filter((account) => account.isActive);
          return (
            <form onSubmit={submit} className="flex flex-col gap-6">
              <Card title="Entry details">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Field label="Date" htmlFor="date">
                    <Input
                      id="date"
                      type="date"
                      required
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </Field>
                  <Field label="Memo" htmlFor="memo">
                    <Input
                      id="memo"
                      required
                      maxLength={280}
                      value={memo}
                      onChange={(e) => setMemo(e.target.value)}
                      placeholder="Invoice 1043, Acme Ltd."
                    />
                  </Field>
                  <Field label="Reference" htmlFor="reference" hint="Optional">
                    <Input
                      id="reference"
                      maxLength={64}
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder="INV-1043"
                    />
                  </Field>
                </div>
              </Card>

              <Card
                title="Lines"
                padded={false}
                actions={
                  complete ? (
                    <Badge tone={balanced ? "positive" : "negative"}>
                      {balanced ? "Balanced" : `Off by ${money(Math.abs(debits - credits))}`}
                    </Badge>
                  ) : null
                }
              >
                <TableWrap>
                  <THead>
                    <TR>
                      <TH>Account</TH>
                      <TH className="w-36">Side</TH>
                      <TH numeric className="w-48">
                        Amount
                      </TH>
                      <TH className="w-24">
                        <span className="sr-only">Actions</span>
                      </TH>
                    </TR>
                  </THead>
                  <TBody>
                    {lines.map((line, i) => {
                      const lineError = line.touched ? parsed[i]!.error : undefined;
                      const errorId = `amount-error-${line.key}`;
                      return (
                        <TR key={line.key}>
                          <TD className="align-top">
                            <Select
                              required
                              aria-label={`Account, line ${i + 1}`}
                              value={line.accountId}
                              onChange={(e) => updateLine(line.key, { accountId: e.target.value })}
                            >
                              <option value="">Select account…</option>
                              {active.map((account) => (
                                <option key={account.id} value={account.id}>
                                  {account.code} · {account.name}
                                </option>
                              ))}
                            </Select>
                          </TD>
                          <TD className="align-top">
                            <Select
                              aria-label={`Side, line ${i + 1}`}
                              value={line.side}
                              onChange={(e) =>
                                updateLine(line.key, { side: e.target.value as DraftLine["side"] })
                              }
                            >
                              <option value="DEBIT">Debit</option>
                              <option value="CREDIT">Credit</option>
                            </Select>
                          </TD>
                          <TD numeric className="align-top">
                            <Input
                              inputMode="decimal"
                              placeholder="0.00"
                              aria-label={`Amount, line ${i + 1}`}
                              aria-invalid={Boolean(lineError)}
                              aria-describedby={lineError ? errorId : undefined}
                              value={line.amount}
                              onChange={(e) => updateLine(line.key, { amount: e.target.value })}
                              onBlur={() => updateLine(line.key, { touched: true })}
                              className="text-right tabular-nums"
                            />
                            {lineError ? (
                              <p id={errorId} className="mt-1 text-left text-xs text-red-600">
                                {lineError}
                              </p>
                            ) : null}
                          </TD>
                          <TD className="text-right align-top">
                            <Button
                              size="sm"
                              variant="ghost"
                              type="button"
                              disabled={lines.length <= 2}
                              aria-label={`Remove line ${i + 1}`}
                              onClick={() => removeLine(line.key)}
                            >
                              Remove
                            </Button>
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </TableWrap>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 px-4 py-3">
                  <Button type="button" onClick={() => setLines((current) => [...current, blankLine()])}>
                    Add line
                  </Button>
                  <dl className="flex gap-6 text-sm">
                    <div className="flex gap-2">
                      <dt className="text-zinc-500">Debits</dt>
                      <dd className="font-medium tabular-nums text-zinc-900">{money(debits)}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-zinc-500">Credits</dt>
                      <dd className="font-medium tabular-nums text-zinc-900">{money(credits)}</dd>
                    </div>
                  </dl>
                </div>
              </Card>

              {error ? (
                <p role="alert" className="text-sm text-red-600">
                  {error}
                </p>
              ) : null}

              <div className="flex justify-end gap-2">
                <Button type="button" onClick={() => navigate("/ledger")}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" loading={submitting}>
                  Post entry
                </Button>
              </div>
            </form>
          );
        }}
      </Async>
    </div>
  );
}
