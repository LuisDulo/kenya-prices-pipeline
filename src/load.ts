import type pg from "pg";

import { FxRate, Inflation, PumpPrice, Reject } from "./types.js";

export interface Counts {
  inserted: number;
  updated: number;
  unchanged: number;
}

/** Postgres reports a row it inserted (rather than updated) with xmax = 0. */
function tally(result: pg.QueryResult, total: number): Counts {
  const inserted = result.rows.filter((r) => r.inserted).length;
  return { inserted, updated: result.rowCount! - inserted, unchanged: total - result.rowCount! };
}

/**
 * Upserts that only rewrite a row when its value actually changed, so a re-run reports
 * exactly what moved and leaves untouched rows alone.
 */
export async function loadPumpPrices(client: pg.PoolClient, rows: PumpPrice[], runId: number): Promise<Counts> {
  const towns = [...new Set(rows.map((r) => r.town))];
  await client.query("INSERT INTO dim_town (name) SELECT unnest($1::text[]) ON CONFLICT (name) DO NOTHING", [towns]);
  const result = await client.query(
    `INSERT INTO fact_pump_price (cycle_start, cycle_end, town_id, product_code, price_kes, run_id)
     SELECT r.cycle_start, r.cycle_end, t.town_id, r.product_code, r.price_kes, $6
     FROM unnest($1::date[], $2::date[], $3::text[], $4::text[], $5::numeric[])
          AS r (cycle_start, cycle_end, town, product_code, price_kes)
     JOIN dim_town t ON t.name = r.town
     ON CONFLICT (cycle_start, town_id, product_code) DO UPDATE
       SET price_kes = EXCLUDED.price_kes, cycle_end = EXCLUDED.cycle_end, run_id = EXCLUDED.run_id
       WHERE (fact_pump_price.price_kes, fact_pump_price.cycle_end)
             IS DISTINCT FROM (EXCLUDED.price_kes, EXCLUDED.cycle_end)
     RETURNING (xmax = 0) AS inserted`,
    [rows.map((r) => r.cycleStart), rows.map((r) => r.cycleEnd), rows.map((r) => r.town),
      rows.map((r) => r.product), rows.map((r) => r.priceKes), runId],
  );
  return tally(result, rows.length);
}

export async function loadInflation(client: pg.PoolClient, rows: Inflation[], runId: number): Promise<Counts> {
  const result = await client.query(
    `INSERT INTO fact_inflation (month, annual_average_pct, twelve_month_pct, run_id)
     SELECT r.*, $4 FROM unnest($1::date[], $2::numeric[], $3::numeric[]) AS r
     ON CONFLICT (month) DO UPDATE
       SET annual_average_pct = EXCLUDED.annual_average_pct,
           twelve_month_pct = EXCLUDED.twelve_month_pct, run_id = EXCLUDED.run_id
       WHERE (fact_inflation.annual_average_pct, fact_inflation.twelve_month_pct)
             IS DISTINCT FROM (EXCLUDED.annual_average_pct, EXCLUDED.twelve_month_pct)
     RETURNING (xmax = 0) AS inserted`,
    [rows.map((r) => r.month), rows.map((r) => r.annualAveragePct), rows.map((r) => r.twelveMonthPct), runId],
  );
  return tally(result, rows.length);
}

export async function loadFx(client: pg.PoolClient, rows: FxRate[], runId: number): Promise<Counts> {
  const currencies = new Map(rows.map((r) => [r.currency, r.quotedAs]));
  await client.query(
    `INSERT INTO dim_currency (code, quoted_as) SELECT * FROM unnest($1::text[], $2::text[])
     ON CONFLICT (code) DO NOTHING`,
    [[...currencies.keys()], [...currencies.values()]],
  );
  const result = await client.query(
    `INSERT INTO fact_fx_rate (rate_date, currency_code, mean, buy, sell, kes_per_unit, run_id)
     SELECT r.*, $7 FROM unnest($1::date[], $2::text[], $3::numeric[], $4::numeric[], $5::numeric[],
                               $6::numeric[]) AS r
     ON CONFLICT (rate_date, currency_code) DO UPDATE
       SET mean = EXCLUDED.mean, buy = EXCLUDED.buy, sell = EXCLUDED.sell,
           kes_per_unit = EXCLUDED.kes_per_unit, run_id = EXCLUDED.run_id
       WHERE (fact_fx_rate.mean, fact_fx_rate.buy, fact_fx_rate.sell)
             IS DISTINCT FROM (EXCLUDED.mean, EXCLUDED.buy, EXCLUDED.sell)
     RETURNING (xmax = 0) AS inserted`,
    [rows.map((r) => r.date), rows.map((r) => r.currency), rows.map((r) => r.mean),
      rows.map((r) => r.buy), rows.map((r) => r.sell), rows.map((r) => r.kesPerUnit), runId],
  );
  return tally(result, rows.length);
}

export async function saveRejects(client: pg.PoolClient | pg.Pool, rejects: Reject[], runId: number) {
  if (!rejects.length) return;
  await client.query(
    `INSERT INTO rejected_rows (run_id, source, line, reason, raw)
     SELECT $1, * FROM unnest($2::text[], $3::int[], $4::text[], $5::text[])`,
    [runId, rejects.map((r) => r.source), rejects.map((r) => r.line), rejects.map((r) => r.reason),
      rejects.map((r) => r.raw.slice(0, 500))],
  );
}
