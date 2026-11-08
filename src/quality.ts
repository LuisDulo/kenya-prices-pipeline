import type pg from "pg";

export interface Check {
  name: string;
  severity: "error" | "warning";
  /** SQL returning one row with a boolean `ok` and a text `detail`. */
  sql: string;
}

/**
 * Checks run inside the load transaction. Any failed error-level check rolls the whole run
 * back, so data that fails them never reaches the tables Power BI reads.
 * $1 is today's date in Nairobi.
 */
export const CHECKS: Check[] = [
  {
    name: "Pump prices are current",
    severity: "error",
    sql: `SELECT COALESCE(MAX(cycle_end) >= $1::date - 7, false) AS ok,
                 'latest cycle ends ' || COALESCE(MAX(cycle_end)::text, 'never') AS detail
          FROM fact_pump_price`,
  },
  {
    name: "Latest pump price cycle covers the country",
    severity: "error",
    sql: `SELECT COUNT(DISTINCT town_id) >= 200 AS ok, COUNT(DISTINCT town_id) || ' towns' AS detail
          FROM fact_pump_price WHERE cycle_start = (SELECT MAX(cycle_start) FROM fact_pump_price)`,
  },
  {
    name: "Pump prices are plausible",
    severity: "error",
    sql: `SELECT COUNT(*) = 0 AS ok, COUNT(*) || ' prices outside KES 80 to 500' AS detail
          FROM fact_pump_price WHERE price_kes NOT BETWEEN 80 AND 500`,
  },
  {
    name: "No pump price jumps more than 30% in one cycle",
    severity: "warning",
    sql: `SELECT COUNT(*) = 0 AS ok, COUNT(*) || ' large jumps' AS detail
          FROM v_pump_prices WHERE ABS(change_pct) > 30`,
  },
  {
    name: "Inflation is current",
    severity: "error",
    sql: `SELECT COALESCE(MAX(month) >= DATE_TRUNC('month', $1::date)::date - INTERVAL '3 months', false) AS ok,
                 'latest month ' || COALESCE(MAX(month)::text, 'never') AS detail
          FROM fact_inflation`,
  },
  {
    name: "Inflation has no missing months",
    severity: "warning",
    sql: `SELECT COUNT(*) = 0 AS ok, COALESCE(STRING_AGG(m::date::text, ', '), 'none') || ' missing' AS detail
          FROM generate_series((SELECT MIN(month) FROM fact_inflation), (SELECT MAX(month) FROM fact_inflation),
                               INTERVAL '1 month') AS m
          WHERE m::date NOT IN (SELECT month FROM fact_inflation)`,
  },
  {
    name: "Exchange rate archive is complete",
    severity: "error",
    sql: `SELECT COUNT(*) >= 30000 AS ok, COUNT(*) || ' rates' AS detail FROM fact_fx_rate`,
  },
  {
    name: "Dollar rates are plausible",
    severity: "error",
    sql: `SELECT COUNT(*) = 0 AS ok, COUNT(*) || ' USD rates outside KES 60 to 200' AS detail
          FROM fact_fx_rate WHERE currency_code = 'USD' AND kes_per_unit NOT BETWEEN 60 AND 200`,
  },
];

export interface CheckResult {
  name: string;
  severity: Check["severity"];
  ok: boolean;
  detail: string;
}

export async function runChecks(client: pg.PoolClient, today: string, checks = CHECKS): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of checks) {
    const { rows } = await client.query(check.sql, check.sql.includes("$1") ? [today] : []);
    results.push({ name: check.name, severity: check.severity, ok: rows[0].ok, detail: rows[0].detail });
  }
  return results;
}
