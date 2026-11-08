import * as cheerio from "cheerio";

import { monthStart } from "../dates.js";
import { Inflation, ParseResult, Reject } from "../types.js";

export const INFLATION_URL = "https://www.centralbank.go.ke/inflation-rates/";
const SOURCE = "cbk_inflation";

/** CBK's monthly inflation table: year, month, annual average and 12-month inflation. */
export function parseInflation(html: string): ParseResult<Inflation> {
  const $ = cheerio.load(html);
  const rows: Inflation[] = [];
  const rejects: Reject[] = [];
  const seen = new Map<string, string>();

  $("table").first().find("tr").each((index, tr) => {
    const cells = $(tr).find("th,td").map((_, c) => $(c).text().replace(/\s+/g, " ").trim()).get();
    const line = index + 1;
    if (cells[0]?.toLowerCase() === "year") return; // the header repeats inside the table
    const reject = (reason: string): void => {
      rejects.push({ source: SOURCE, line, reason, raw: cells.join(" | ") });
    };
    if (cells.length !== 4) return reject("expected 4 cells");

    const month = monthStart(Number(cells[0]), cells[1]);
    if (!month) return reject("invalid year or month");
    // Number("") is 0, so a blank cell would otherwise load as zero inflation.
    if (cells.slice(2).some((c) => c === "")) return reject("rate missing or out of range");
    const [annualAveragePct, twelveMonthPct] = cells.slice(2).map(Number);
    if (![annualAveragePct, twelveMonthPct].every((v) => Number.isFinite(v) && v > -20 && v < 100)) {
      return reject("rate missing or out of range");
    }
    const signature = `${annualAveragePct}|${twelveMonthPct}`;
    if (seen.has(month)) {
      return reject(seen.get(month) === signature ? "exact duplicate" : "conflicting duplicate");
    }
    seen.set(month, signature);
    rows.push({ month, annualAveragePct, twelveMonthPct });
  });

  // A conflicting duplicate means neither value can be trusted, so drop the kept copy too.
  const conflicted = new Set(rejects.filter((r) => r.reason === "conflicting duplicate").map((r) => {
    const [year, monthName] = r.raw.split(" | ");
    return monthStart(Number(year), monthName);
  }));
  return { rows: rows.filter((r) => !conflicted.has(r.month)), rejects };
}
