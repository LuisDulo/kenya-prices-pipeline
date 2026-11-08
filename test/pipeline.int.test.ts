import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { connect, migrate } from "../src/db.js";
import { exportCurated } from "../src/export.js";
import { Extracted, loadAndCheck } from "../src/pipeline.js";
import { Check } from "../src/quality.js";
import { PumpPrice } from "../src/types.js";

/** Runs against a real PostgreSQL. CI provides one; locally set TEST_DATABASE_URL to run these. */
const url = process.env.TEST_DATABASE_URL;
const TODAY = "2026-11-08";

const ALWAYS_PASS: Check[] = [{ name: "always", severity: "error", sql: "SELECT true AS ok, 'fine' AS detail" }];
const NEEDS_TOWNS: Check[] = [{
  name: "needs 500 towns", severity: "error",
  sql: "SELECT COUNT(*) >= 500 AS ok, COUNT(*) || ' towns' AS detail FROM dim_town",
}];

function pump(price = 226.96): PumpPrice[] {
  return [
    { cycleStart: "2026-09-15", cycleEnd: "2026-10-14", town: "Nairobi", product: "PMS", priceKes: 214.03 },
    { cycleStart: "2026-10-15", cycleEnd: "2026-11-14", town: "Nairobi", product: "PMS", priceKes: price },
    { cycleStart: "2026-10-15", cycleEnd: "2026-11-14", town: "Mombasa", product: "PMS", priceKes: 223.81 },
  ];
}

function data(price?: number): Extracted {
  return {
    pump: { rows: pump(price), rejects: [{ source: "epra", line: 9, reason: "exact duplicate", raw: "x" }] },
    inflation: { rows: [{ month: "2026-10-01", annualAveragePct: 5.67, twelveMonthPct: 7.32 }], rejects: [] },
    fx: { rows: [{ date: "2023-12-29", currency: "USD", quotedAs: "kes_per_unit", mean: 156.46, buy: 156.36, sell: 156.56, kesPerUnit: 156.46 }], rejects: [] },
  };
}

describe.skipIf(!url)("pipeline against PostgreSQL", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = connect(url);
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await migrate(pool);
  });

  beforeEach(async () => {
    await pool.query(`TRUNCATE fact_pump_price, fact_inflation, fact_fx_rate, dim_town, dim_currency,
                      rejected_rows, pipeline_runs RESTART IDENTITY CASCADE`);
  });

  afterAll(async () => pool?.end());

  it("applies each migration only once", async () => {
    expect(await migrate(pool)).toEqual([]);
  });

  it("loads all three sources and records the run and its rejects", async () => {
    const summary = await loadAndCheck(pool, data(), TODAY, ALWAYS_PASS);
    expect(summary.status).toBe("succeeded");
    expect(summary.loaded.pump_prices).toEqual({ inserted: 3, updated: 0, unchanged: 0 });
    const run = (await pool.query("SELECT status, summary FROM pipeline_runs")).rows[0];
    expect(run.status).toBe("succeeded");
    expect((await pool.query("SELECT reason FROM rejected_rows")).rows).toEqual([{ reason: "exact duplicate" }]);
  });

  it("changes nothing when the same data is loaded again", async () => {
    await loadAndCheck(pool, data(), TODAY, ALWAYS_PASS);
    const again = await loadAndCheck(pool, data(), TODAY, ALWAYS_PASS);
    expect(again.loaded.pump_prices).toEqual({ inserted: 0, updated: 0, unchanged: 3 });
    expect(again.loaded.inflation).toEqual({ inserted: 0, updated: 0, unchanged: 1 });
  });

  it("updates only the price that changed", async () => {
    await loadAndCheck(pool, data(), TODAY, ALWAYS_PASS);
    const changed = await loadAndCheck(pool, data(230.0), TODAY, ALWAYS_PASS);
    expect(changed.loaded.pump_prices).toEqual({ inserted: 0, updated: 1, unchanged: 2 });
  });

  it("rolls everything back when a quality check fails, but keeps the run record", async () => {
    const summary = await loadAndCheck(pool, data(), TODAY, NEEDS_TOWNS);
    expect(summary.status).toBe("failed");
    expect(summary.error).toMatch(/needs 500 towns/);
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM fact_pump_price")).rows[0].n).toBe(0);
    expect((await pool.query("SELECT status FROM pipeline_runs")).rows[0].status).toBe("failed");
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM rejected_rows")).rows[0].n).toBe(1);
  });

  it("works out the change from the previous cycle", async () => {
    await loadAndCheck(pool, data(), TODAY, ALWAYS_PASS);
    const { rows } = await pool.query("SELECT change_kes FROM v_pump_prices WHERE town = 'Nairobi' ORDER BY cycle_start");
    expect(rows.map((r) => r.change_kes)).toEqual([null, "12.93"]);
  });

  it("leaves the change unknown when a town is missing from the previous notice", async () => {
    // Mombasa has no price in the September notice, so its October change cannot be known.
    await loadAndCheck(pool, data(), TODAY, ALWAYS_PASS);
    const { rows } = await pool.query("SELECT change_kes FROM v_pump_prices WHERE town = 'Mombasa'");
    expect(rows).toEqual([{ change_kes: null }]);
  });

  it("compares a revised notice with the one it replaced", async () => {
    const revised = data();
    revised.pump.rows.push({ cycleStart: "2026-10-16", cycleEnd: "2026-11-14", town: "Nairobi", product: "PMS", priceKes: 220.0 });
    await loadAndCheck(pool, revised, TODAY, ALWAYS_PASS);
    const { rows } = await pool.query("SELECT cycle_start, change_kes FROM v_pump_prices WHERE town = 'Nairobi' ORDER BY cycle_start");
    expect(rows.map((r) => [r.cycle_start, r.change_kes])).toEqual([
      ["2026-09-15", null], ["2026-10-15", "12.93"], ["2026-10-16", "-6.96"]]);
  });

  it("puts Nairobi fuel beside inflation, one row per price notice", async () => {
    await loadAndCheck(pool, data(), TODAY, ALWAYS_PASS);
    const { rows } = await pool.query("SELECT * FROM v_fuel_vs_inflation WHERE cycle_start = '2026-10-15'");
    expect(rows[0].nairobi_petrol_kes).toBe("226.96");
    expect(rows[0].inflation_pct).toBe("7.32");
  });

  it("exports sorted CSV files with headers", async () => {
    await loadAndCheck(pool, data(), TODAY, ALWAYS_PASS);
    const dir = await mkdtemp(path.join(os.tmpdir(), "curated-"));
    const counts = await exportCurated(pool, dir);
    expect(counts["pump_prices.csv"]).toBe(3);
    const lines = (await readFile(path.join(dir, "pump_prices.csv"), "utf8")).trim().split("\n");
    expect(lines[0]).toBe("cycle_start,cycle_end,town,product_code,product_name,price_kes,change_kes,change_pct");
    expect(lines[1].startsWith("2026-09-15,2026-10-14,Nairobi,PMS")).toBe(true);
  });
});
