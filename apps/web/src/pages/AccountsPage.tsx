import { useState } from "react";
import { ACCOUNT_TYPES, type Account, type CreateAccountInput } from "@ledgerlab/shared";
import {
  Badge,
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
  cn,
} from "@ledgerlab/ui";
import { Async } from "../components/states";
import { api, ApiError } from "../lib/api";
import { useAsync } from "../lib/useAsync";

const EMPTY: CreateAccountInput = { code: "", name: "", type: "ASSET", currency: "USD" };

const typeLabel = (type: string) => type.charAt(0) + type.slice(1).toLowerCase();

export function AccountsPage() {
  const { data, loading, error, reload } = useAsync(() => api.ledger.listAccounts(), []);
  const [form, setForm] = useState<CreateAccountInput>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | undefined>(undefined);
  const [actionError, setActionError] = useState<string | undefined>(undefined);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(undefined);
    try {
      await api.ledger.createAccount(form);
      setForm(EMPTY);
      reload();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not create the account.");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(account: Account) {
    if (
      account.isActive &&
      !window.confirm(
        `Deactivate ${account.code} ${account.name}? New entries cannot use it. Existing entries and reports are unchanged.`,
      )
    ) {
      return;
    }
    setBusyId(account.id);
    setActionError(undefined);
    try {
      await api.ledger.setAccountActive(account.id, !account.isActive);
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not update the account.");
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Chart of accounts" description="The accounts your ledger can post to." />

      <Card title="Add an account">
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-[8rem_1fr_10rem_auto]">
          <Field label="Code" htmlFor="code" hint="Four digits">
            <Input
              id="code"
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              required
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="6200"
            />
          </Field>
          <Field label="Name" htmlFor="name">
            <Input
              id="name"
              required
              maxLength={120}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Software subscriptions"
            />
          </Field>
          <Field label="Type" htmlFor="type">
            <Select
              id="type"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as CreateAccountInput["type"] })}
            >
              {ACCOUNT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {typeLabel(type)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-start sm:pt-6">
            <Button type="submit" variant="primary" loading={submitting}>
              Add account
            </Button>
          </div>
        </form>
        {formError ? (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {formError}
          </p>
        ) : null}
      </Card>

      {actionError ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {actionError}
        </p>
      ) : null}

      <Card title="Accounts" padded={false}>
        <Async loading={loading} error={error} data={data} onRetry={reload}>
          {(accounts) =>
            accounts.length === 0 ? (
              <EmptyState
                title="No accounts yet"
                description="Add your first account above, for example 1000 Cash."
              />
            ) : (
              <TableWrap>
                <THead>
                  <TR>
                    <TH className="w-20">Code</TH>
                    <TH>Name</TH>
                    <TH className="w-28">Type</TH>
                    <TH className="hidden w-24 sm:table-cell">Currency</TH>
                    <TH className="w-24">Status</TH>
                    <TH className="w-32">
                      <span className="sr-only">Actions</span>
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {accounts.map((account) => (
                    <TR key={account.id}>
                      <TD className="font-mono text-xs text-zinc-500">{account.code}</TD>
                      <TD className={cn("font-medium", account.isActive ? "text-zinc-900" : "text-zinc-500")}>
                        {account.name}
                      </TD>
                      <TD muted>{typeLabel(account.type)}</TD>
                      <TD muted className="hidden sm:table-cell">
                        {account.currency}
                      </TD>
                      <TD>
                        {account.isActive ? (
                          <span className="text-zinc-500">Active</span>
                        ) : (
                          <Badge tone="warning">inactive</Badge>
                        )}
                      </TD>
                      <TD className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={busyId === account.id}
                          aria-label={`${account.isActive ? "Deactivate" : "Reactivate"} ${account.name}`}
                          onClick={() => void toggleActive(account)}
                        >
                          {account.isActive ? "Deactivate" : "Reactivate"}
                        </Button>
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
