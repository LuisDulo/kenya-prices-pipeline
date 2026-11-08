import type pg from "pg";

import { Counts, loadFx, loadInflation, loadPumpPrices, saveRejects } from "./load.js";
import { Check, CHECKS, CheckResult, runChecks } from "./quality.js";
import { FxRate, Inflation, ParseResult, PumpPrice, Reject } from "./types.js";

export interface Extracted {
  pump: ParseResult<PumpPrice>;
  inflation: ParseResult<Inflation>;
  fx: ParseResult<FxRate> | null;
}

export interface RunSummary {
  runId: number;
  status: "succeeded" | "failed";
  loaded: Record<string, Counts>;
  rejected: Record<string, number>;
  checks: CheckResult[];
  error?: string;
}

function countBySource(rejects: Reject[]): Record<string, number> {
  return rejects.reduce<Record<string, number>>((all, r) => ({ ...all, [r.source]: (all[r.source] ?? 0) + 1 }), {});
}

/**
 * Write, audit, publish: load everything in one transaction, run the quality checks against it,
 * and commit only if every error-level check passes. The run and its rejected rows are always
 * recorded, even when the data is rolled back.
 */
export async function loadAndCheck(pool: pg.Pool, data: Extracted, today: string,
  checks: Check[] = CHECKS): Promise<RunSummary> {
  const runId: number = (await pool.query("INSERT INTO pipeline_runs DEFAULT VALUES RETURNING id")).rows[0].id;
  const rejects = [...data.pump.rejects, ...data.inflation.rejects, ...(data.fx?.rejects ?? [])];
  const summary: RunSummary = { runId, status: "failed", loaded: {}, rejected: countBySource(rejects), checks: [] };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    summary.loaded.pump_prices = await loadPumpPrices(client, data.pump.rows, runId);
    summary.loaded.inflation = await loadInflation(client, data.inflation.rows, runId);
    if (data.fx) summary.loaded.fx_rates = await loadFx(client, data.fx.rows, runId);
    summary.checks = await runChecks(client, today, checks);
    const failed = summary.checks.filter((c) => !c.ok && c.severity === "error");
    if (failed.length) {
      await client.query("ROLLBACK");
      summary.error = `Quality checks failed: ${failed.map((c) => `${c.name} (${c.detail})`).join("; ")}`;
    } else {
      await client.query("COMMIT");
      summary.status = "succeeded";
    }
  } catch (error) {
    await client.query("ROLLBACK");
    summary.error = error instanceof Error ? error.message : String(error);
  } finally {
    client.release();
  }

  await saveRejects(pool, rejects, runId);
  await pool.query("UPDATE pipeline_runs SET status = $1, finished_at = now(), summary = $2 WHERE id = $3",
    [summary.status, JSON.stringify(summary), runId]);
  return summary;
}
