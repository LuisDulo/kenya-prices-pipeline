import * as cheerio from "cheerio";

import { parseDate } from "../dates.js";
import { ParseResult, Product, PumpPrice, Reject } from "../types.js";

export const EPRA_URL = "https://www.epra.go.ke/pump-prices";
const SOURCE = "epra";
const PRODUCTS: Product[] = ["PMS", "AGO", "IK"];
const EXPECTED_HEADER = ["from", "to", "town", "super (pms)", "diesel (ago)", "kerosene (ik)"];

/** EPRA's pump price table: one row per town per monthly cycle, three fuels per row. */
export function parseEpra(html: string): ParseResult<PumpPrice> {
  const $ = cheerio.load(html);
  const rejects: Reject[] = [];
  const byKey = new Map<string, { rows: PumpPrice[]; line: number; signature: string }>();
  const conflicted = new Set<string>();
  const table = $("table").first();
  if (!table.length) throw new Error("EPRA page has no price table. The page layout may have changed.");

  const header = table.find("tr").first().find("th,td").map((_, c) => $(c).text().trim().toLowerCase()).get();
  if (header.join("|") !== EXPECTED_HEADER.join("|")) {
    throw new Error(`EPRA table columns changed: ${header.join(", ")}`);
  }

  table.find("tr").slice(1).each((index, tr) => {
    const cells = $(tr).find("td").map((_, c) => $(c).text().replace(/\s+/g, " ").trim()).get();
    const line = index + 2;
    const reject = (reason: string): void => {
      rejects.push({ source: SOURCE, line, reason, raw: cells.join(" | ") });
    };
    if (cells.length !== 6) return reject("expected 6 cells");

    const [from, to, rawTown, ...prices] = cells;
    const cycleStart = parseDate(from);
    const cycleEnd = parseDate(to);
    if (!cycleStart || !cycleEnd || cycleEnd <= cycleStart) return reject("invalid cycle dates");
    const town = rawTown.trim();
    if (!town) return reject("missing town");

    const key = `${cycleStart}|${town.toLowerCase()}`;
    const signature = prices.join("|");
    const existing = byKey.get(key);
    if (existing) {
      if (existing.signature === signature) return reject("exact duplicate");
      conflicted.add(key);
      return reject("conflicting duplicate");
    }

    const rows: PumpPrice[] = [];
    prices.forEach((text, i) => {
      if (text === "" || text === "-") return;
      const price = Number(text.replace(/,/g, ""));
      if (!Number.isFinite(price) || price < 50 || price > 1000) {
        return reject(`${PRODUCTS[i]} price out of range: ${text}`);
      }
      rows.push({ cycleStart, cycleEnd, town, product: PRODUCTS[i], priceKes: price });
    });
    byKey.set(key, { rows, line, signature });
  });

  // When EPRA lists one town twice with different prices, neither row can be trusted.
  for (const key of conflicted) {
    const kept = byKey.get(key)!;
    rejects.push({ source: SOURCE, line: kept.line, reason: "conflicting duplicate", raw: `${key}|${kept.signature}` });
    byKey.delete(key);
  }
  return { rows: [...byKey.values()].flatMap((entry) => entry.rows), rejects };
}
