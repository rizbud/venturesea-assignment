import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "./cn";

const CONTROL =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-xs " +
  "placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 " +
  "disabled:cursor-not-allowed disabled:bg-zinc-50 " +
  // Variants sort after base utilities, so these reliably override the zinc/indigo colours.
  "aria-invalid:border-red-500 aria-invalid:focus:border-red-500 aria-invalid:focus:ring-red-100";

export interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}

export function Field({ label, htmlFor, hint, error, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-zinc-700">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : hint ? (
        <p className="text-xs text-zinc-500">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cn(CONTROL, className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cn(CONTROL, "pr-8", className)}>
      {children}
    </select>
  );
}
