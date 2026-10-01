import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-700 focus-visible:outline-indigo-600",
  secondary:
    "bg-white text-zinc-900 ring-1 ring-inset ring-zinc-300 hover:bg-zinc-50 focus-visible:outline-zinc-400",
  ghost: "bg-transparent text-zinc-700 hover:bg-zinc-100 focus-visible:outline-zinc-400",
  danger: "bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-600",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
};

/** Button styling for elements that must not be a <button>, e.g. a router <Link>. */
export function buttonClasses({
  variant = "secondary",
  size = "md",
  className,
}: { variant?: Variant; size?: Size; className?: string } = {}): string {
  return cn(
    "inline-flex items-center justify-center rounded-md font-medium transition-colors",
    "focus-visible:outline-2 focus-visible:outline-offset-2",
    "disabled:cursor-not-allowed disabled:opacity-50",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  className,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button {...rest} disabled={disabled || loading} className={buttonClasses({ variant, size, className })}>
      {loading ? (
        <span
          aria-hidden
          className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : null}
      {children}
    </button>
  );
}
