/** A source row that was not loaded, kept with the reason so nothing disappears silently. */
export interface Reject {
  source: string;
  line: number;
  reason: string;
  raw: string;
}

export interface ParseResult<T> {
  rows: T[];
  rejects: Reject[];
}

export type Product = "PMS" | "AGO" | "IK";

export interface PumpPrice {
  cycleStart: string;
  cycleEnd: string;
  town: string;
  product: Product;
  priceKes: number;
}

export interface Inflation {
  month: string;
  annualAveragePct: number;
  twelveMonthPct: number;
}

export type Quote = "kes_per_unit" | "kes_per_100" | "units_per_kes";

export interface FxRate {
  date: string;
  currency: string;
  quotedAs: Quote;
  mean: number;
  buy: number;
  sell: number;
  kesPerUnit: number;
}
