import type { EntryStatus } from "@ledgerlab/shared";
import { Badge } from "@ledgerlab/ui";

/** POSTED is the normal state, so it stays neutral; only exceptions get colour. */
const TONE = { POSTED: "neutral", VOID: "negative", DRAFT: "warning" } as const;

export function EntryStatusBadge({ status }: { status: EntryStatus }) {
  return <Badge tone={TONE[status]}>{status.toLowerCase()}</Badge>;
}
