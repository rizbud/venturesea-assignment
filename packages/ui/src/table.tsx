import type { HTMLAttributes, ReactNode, ThHTMLAttributes, TdHTMLAttributes } from "react";
import { cn } from "./cn";

export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="border-b border-zinc-200">{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-zinc-100 [&>tr:hover]:bg-zinc-50/60">{children}</tbody>;
}

export function TR({ className, children, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr {...rest} className={className}>
      {children}
    </tr>
  );
}

export interface THProps extends ThHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean;
}

export function TH({ numeric, className, children, ...rest }: THProps) {
  return (
    <th
      {...rest}
      scope="col"
      className={cn(
        "px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-zinc-500",
        numeric ? "text-right" : "text-left",
        className,
      )}
    >
      {children}
    </th>
  );
}

export interface TDProps extends TdHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean;
  muted?: boolean;
}

export function TD({ numeric, muted, className, children, ...rest }: TDProps) {
  return (
    <td
      {...rest}
      className={cn(
        "px-4 py-2.5 align-middle text-zinc-800",
        numeric && "text-right tabular-nums",
        muted && "text-zinc-500",
        className,
      )}
    >
      {children}
    </td>
  );
}
