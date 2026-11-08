import { parse } from "csv-parse/sync";

import { parseDate } from "../dates.js";
import { FxRate, ParseResult, Quote, Reject } from "../types.js";

/** CBK stopped updating this file on 4 January 2024. It is loaded as a historical archive. */
export const FX_ARCHIVE_URL = "https://www.centralbank.go.ke/uploads/fx_rates/historical_data.csv";
const SOURCE = "cbk_fx_archive";

/**
 * CBK labels, written several ways over the years, mapped to ISO codes and to how the rate is
 * quoted. "KES / USHS" means Ugandan shillings per Kenyan shilling, the opposite direction.
 */
const CURRENCIES: Record<string, [string, Quote]> = {
  "US DOLLAR": ["USD", "kes_per_unit"],
  "STG POUND": ["GBP", "kes_per_unit"],
  "EURO": ["EUR", "kes_per_unit"],
  "SA RAND": ["ZAR", "kes_per_unit"],
  "AE DIRHAM": ["AED", "kes_per_unit"],
  "CAN $": ["CAD", "kes_per_unit"],
  "S FRANC": ["CHF", "kes_per_unit"],
  "JPY (100)": ["JPY", "kes_per_100"],
  "SW KRONER": ["SEK", "kes_per_unit"],
  "NOR KRONER": ["NOK", "kes_per_unit"],
  "DAN KRONER": ["DKK", "kes_per_unit"],
  "IND RUPEE": ["INR", "kes_per_unit"],
  "HONGKONG DOLLAR": ["HKD", "kes_per_unit"],
  "SINGAPORE $": ["SGD", "kes_per_unit"],
  "SINGAPORE DOLLAR": ["SGD", "kes_per_unit"],
  "SAUDI RIYAL": ["SAR", "kes_per_unit"],
  "CHINESE YUAN": ["CNY", "kes_per_unit"],
  "AUSTRALIAN $": ["AUD", "kes_per_unit"],
  "KES/USHS": ["UGX", "units_per_kes"],
  "KES/TSHS": ["TZS", "units_per_kes"],
  "KES/RWF": ["RWF", "units_per_kes"],
  "KES/BIF": ["BIF", "units_per_kes"],
};

export function normaliseLabel(label: string): string {
  return label.toUpperCase().replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").trim();
}

/** Kenyan shillings for one unit of the currency, whichever way CBK quoted it. */
export function kesPerUnit(mean: number, quotedAs: Quote): number {
  const value = quotedAs === "units_per_kes" ? 1 / mean : quotedAs === "kes_per_100" ? mean / 100 : mean;
  return Number(value.toFixed(8));
}

/** Parse one line on its own, so a single malformed line cannot stop the whole file. */
function cellsOf(line: string): string[] | null {
  try {
    return parse(line, { relax_column_count: true, relax_quotes: true, trim: true })[0] ?? [];
  } catch {
    return null;
  }
}

export function parseFx(csv: string, today: string): ParseResult<FxRate> {
  const rejects: Reject[] = [];
  const byKey = new Map<string, { row: FxRate; line: number; signature: string }>();
  const conflicted = new Set<string>();

  csv.split(/\r?\n/).forEach((text, index) => {
    if (!text.trim()) return;
    const line = index + 1;
    const parsed = cellsOf(text);
    const cells = parsed ?? [text];
    const reject = (reason: string): void => {
      rejects.push({ source: SOURCE, line, reason, raw: parsed ? cells.join(",") : text });
    };
    if (!parsed) return reject("malformed CSV line");
    if (cells.length !== 5) return reject("expected 5 columns");
    const date = parseDate(cells[0]);
    if (!date) return reject("not a date");
    if (date > today) return reject("date in the future");
    const known = CURRENCIES[normaliseLabel(cells[1])];
    if (!known) return reject(`unknown currency ${cells[1] || "(blank)"}`);
    const [mean, buy, sell] = cells.slice(2).map(Number);
    if (![mean, buy, sell].every((v) => Number.isFinite(v) && v > 0)) return reject("rate missing or not positive");
    if (buy > sell || mean < buy || mean > sell) return reject("buy, mean and sell out of order");

    const [currency, quotedAs] = known;
    const key = `${date}|${currency}`;
    const signature = `${mean}|${buy}|${sell}`;
    const existing = byKey.get(key);
    if (existing) {
      if (existing.signature === signature) return reject("exact duplicate");
      conflicted.add(key);
      return reject("conflicting duplicate");
    }
    byKey.set(key, { row: { date, currency, quotedAs, mean, buy, sell, kesPerUnit: kesPerUnit(mean, quotedAs) }, line, signature });
  });

  // When CBK published two different rates for one day, neither can be trusted.
  for (const key of conflicted) {
    const kept = byKey.get(key)!;
    rejects.push({ source: SOURCE, line: kept.line, reason: "conflicting duplicate", raw: `${key}|${kept.signature}` });
    byKey.delete(key);
  }
  return { rows: [...byKey.values()].map((v) => v.row), rejects };
}
