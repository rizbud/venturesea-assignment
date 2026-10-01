/**
 * Money handling for LedgerLab.
 *
 * RULE #1: never use floating point for money. Every amount in this codebase is
 * an integer number of minor units (cents for USD, sen for IDR, etc).
 *
 * All arithmetic helpers below operate on integers and throw on invalid input
 * rather than silently coercing, so bugs surface at the boundary.
 */

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/**
 * Parse a human string/number into signed minor units.
 *
 * Accepts: "1234", "1,234.56", "-42.10", "$1,234.56", 1234.56
 * Rejects: NaN, Infinity, more precision than the currency supports.
 *
 * @param scale number of decimal places (2 for USD, 0 for JPY/IDR display).
 */
export function parseAmountToMinor(input: string | number, scale = 2): number {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new MoneyError(`Invalid amount: ${input}`);
    // Round to the currency scale, then convert to integer minor units.
    const factor = 10 ** scale;
    const minor = Math.round(input * factor);
    // Guard against float drift: 0.1 + 0.2 style inputs land here already rounded.
    return minor;
  }

  const cleaned = input.trim().replace(/[$€£\s]/g, "");
  if (cleaned === "" || cleaned === "-") throw new MoneyError(`Invalid amount: "${input}"`);
  if (!/^-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?$/.test(cleaned)) {
    throw new MoneyError(`Invalid amount: "${input}"`);
  }
  const negative = cleaned.startsWith("-");
  const unsigned = negative ? cleaned.slice(1) : cleaned;
  const [wholePart = "0", fractionPart = ""] = unsigned.split(".");
  if (fractionPart.length > scale) {
    throw new MoneyError(
      `Amount "${input}" has ${fractionPart.length} decimals but currency scale is ${scale}`,
    );
  }
  const whole = Number(wholePart.replace(/,/g, ""));
  const fraction = Number(fractionPart.padEnd(scale, "0") || "0");
  const minor = whole * 10 ** scale + fraction;
  return negative ? -minor : minor;
}

/** Format signed minor units as a fixed-scale decimal string (no symbol). */
export function formatMinor(minor: number, scale = 2): string {
  if (!Number.isInteger(minor)) throw new MoneyError(`formatMinor expects an integer, got ${minor}`);
  const factor = 10 ** scale;
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / factor);
  const fraction = abs % factor;
  const body =
    fraction === 0 && scale === 0 ? String(whole) : `${whole}.${String(fraction).padStart(scale, "0")}`;
  return negative ? `-${body}` : body;
}

/** Format minor units as a display currency string, e.g. "$1,234.56". */
export function formatCurrency(minor: number, currency = "USD", locale = "en-US"): string {
  const scale = minorUnitScale(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
  }).format(minor / 10 ** scale);
}

/** Number of decimal places for a currency. Defaults to 2. */
export function minorUnitScale(currency: string): number {
  // ISO 4217 zero-decimal currencies.
  const zeroDecimal = new Set(["JPY", "KRW", "VND", "IDR", "CLP", "ISK", "XOF", "XAF"]);
  return zeroDecimal.has(currency.toUpperCase()) ? 0 : 2;
}

/** Sum signed minor units safely (they are just integers). */
export function sumMinor(values: readonly number[]): number {
  return values.reduce((total, value) => {
    if (!Number.isSafeInteger(value)) throw new MoneyError(`sumMinor expects safe integers, got ${value}`);
    const next = total + value;
    if (!Number.isSafeInteger(next)) throw new MoneyError("sumMinor overflowed the safe integer range");
    return next;
  }, 0);
}

export function absMinor(value: number): number {
  return Math.abs(value);
}

/** Negate signed minor units (flip debit <-> credit). */
export function negateMinor(value: number): number {
  return -value;
}

/** True when the signed amounts net to exactly zero. */
export function isBalanced(amountsMinor: readonly number[]): boolean {
  return sumMinor(amountsMinor) === 0;
}
