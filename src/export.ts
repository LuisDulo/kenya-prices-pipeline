import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { stringify } from "csv-stringify/sync";
import type pg from "pg";

/** Each file is sorted, so it only changes when the data does and its git history stays readable. */
export const EXPORTS: { file: string; sql: string }[] = [
  { file: "pump_prices.csv", sql: "SELECT * FROM v_pump_prices ORDER BY cycle_start, town, product_code" },
  { file: "inflation.csv", sql: "SELECT * FROM v_inflation ORDER BY month" },
  { file: "fuel_vs_inflation.csv", sql: "SELECT * FROM v_fuel_vs_inflation ORDER BY cycle_start" },
  { file: "fx_rates_archive.csv", sql: "SELECT * FROM v_fx_archive ORDER BY rate_date, currency_code" },
];

function cell(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

export async function exportCurated(pool: pg.Pool, directory: string): Promise<Record<string, number>> {
  await mkdir(directory, { recursive: true });
  const counts: Record<string, number> = {};
  for (const { file, sql } of EXPORTS) {
    const { rows, fields } = await pool.query(sql);
    const header = fields.map((f) => f.name);
    const body = rows.map((row) => header.map((name) => cell(row[name])));
    await writeFile(path.join(directory, file), stringify([header, ...body], { record_delimiter: "\n" }));
    counts[file] = rows.length;
  }
  return counts;
}
