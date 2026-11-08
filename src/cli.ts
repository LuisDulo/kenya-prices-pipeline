import path from "node:path";

import { todayInNairobi } from "./dates.js";
import { connect, migrate } from "./db.js";
import { exportCurated } from "./export.js";
import { politeFetch } from "./fetch.js";
import { Extracted, loadAndCheck } from "./pipeline.js";
import { EPRA_URL, parseEpra } from "./sources/epra.js";
import { FX_ARCHIVE_URL, parseFx } from "./sources/fx.js";
import { INFLATION_URL, parseInflation } from "./sources/inflation.js";

const RAW = path.resolve("data/raw");
const CURATED = path.resolve("data/curated");

function report(label: string, value: unknown) {
  console.log(`${label.padEnd(52)} ${typeof value === "string" ? value : JSON.stringify(value)}`);
}

async function run() {
  const today = todayInNairobi();
  const pool = connect();
  try {
    await migrate(pool);
    const stamp = today;
    const fetchAndCache = (url: string, name: string) =>
      politeFetch(url, { cacheDir: RAW, cacheName: `${stamp}-${name}` });

    const archiveLoaded = (await pool.query("SELECT EXISTS (SELECT 1 FROM fact_fx_rate) AS loaded")).rows[0].loaded;
    const data: Extracted = {
      pump: parseEpra(await fetchAndCache(EPRA_URL, "epra.html")),
      inflation: parseInflation(await fetchAndCache(INFLATION_URL, "inflation.html")),
      // The archive no longer changes, so it is fetched only into an empty database.
      fx: archiveLoaded ? null : parseFx(await fetchAndCache(FX_ARCHIVE_URL, "fx.csv"), today),
    };

    const summary = await loadAndCheck(pool, data, today);
    report("Run", `${summary.runId} ${summary.status}`);
    for (const [name, counts] of Object.entries(summary.loaded)) report(`Loaded ${name}`, counts);
    for (const [source, count] of Object.entries(summary.rejected)) report(`Rejected from ${source}`, String(count));
    for (const check of summary.checks) {
      report(`${check.ok ? "PASS" : check.severity === "error" ? "FAIL" : "WARN"} ${check.name}`, check.detail);
    }
    if (summary.status !== "succeeded") {
      console.error(summary.error);
      process.exitCode = 1;
      return;
    }
    report("Exported", await exportCurated(pool, CURATED));
  } finally {
    await pool.end();
  }
}

const command = process.argv[2];
if (command === "run") {
  await run();
} else if (command === "migrate") {
  const pool = connect();
  console.log("Applied:", (await migrate(pool)).join(", ") || "nothing new");
  await pool.end();
} else {
  console.error("Usage: tsx src/cli.ts run | migrate");
  process.exitCode = 2;
}
