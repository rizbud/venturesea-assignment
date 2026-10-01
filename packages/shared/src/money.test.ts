import { describe, expect, it } from "vitest";
import {
  MoneyError,
  formatCurrency,
  formatMinor,
  isBalanced,
  minorUnitScale,
  parseAmountToMinor,
  sumMinor,
} from "./money";

describe("parseAmountToMinor", () => {
  it("parses plain integers", () => {
    expect(parseAmountToMinor("1234")).toBe(123400);
  });

  it("parses decimals", () => {
    expect(parseAmountToMinor("0.01")).toBe(1);
    expect(parseAmountToMinor("42.10")).toBe(4210);
  });

  it("parses thousands separators and currency symbols", () => {
    expect(parseAmountToMinor("$1,234.56")).toBe(123456);
    expect(parseAmountToMinor("-1,000.00")).toBe(-100000);
  });

  it("parses numeric input without float drift", () => {
    expect(parseAmountToMinor(0.1 + 0.2)).toBe(30);
    expect(parseAmountToMinor(19.99)).toBe(1999);
  });

  it("rejects garbage", () => {
    expect(() => parseAmountToMinor("abc")).toThrow(MoneyError);
    expect(() => parseAmountToMinor("")).toThrow(MoneyError);
    expect(() => parseAmountToMinor(Number.NaN)).toThrow(MoneyError);
  });

  it("rejects excess precision for the currency scale", () => {
    expect(() => parseAmountToMinor("1.005")).toThrow(MoneyError);
  });

  it("supports zero-decimal currencies", () => {
    expect(parseAmountToMinor("50000", 0)).toBe(50000);
    expect(() => parseAmountToMinor("50000.5", 0)).toThrow(MoneyError);
  });
});

describe("formatMinor", () => {
  it("renders fixed scale", () => {
    expect(formatMinor(1)).toBe("0.01");
    expect(formatMinor(-123456)).toBe("-1234.56");
    expect(formatMinor(50000, 0)).toBe("50000");
  });

  it("rejects non-integers", () => {
    expect(() => formatMinor(1.5)).toThrow(MoneyError);
  });
});

describe("formatCurrency", () => {
  it("formats USD", () => {
    expect(formatCurrency(123456, "USD")).toBe("$1,234.56");
  });

  it("respects zero-decimal currency scale", () => {
    expect(minorUnitScale("IDR")).toBe(0);
    expect(minorUnitScale("USD")).toBe(2);
  });
});

describe("balancing helpers", () => {
  it("sums integer minor units", () => {
    expect(sumMinor([100, -60, -40])).toBe(0);
  });

  it("rejects non-integer input", () => {
    expect(() => sumMinor([1.5])).toThrow(MoneyError);
  });

  it("rejects amounts and totals beyond the safe integer range", () => {
    expect(() => sumMinor([2 ** 53])).toThrow(MoneyError);
    expect(() => sumMinor([Number.MAX_SAFE_INTEGER, 1])).toThrow(MoneyError);
  });

  it("detects a balanced set", () => {
    expect(isBalanced([100, -100])).toBe(true);
    expect(isBalanced([100, -99])).toBe(false);
  });
});
