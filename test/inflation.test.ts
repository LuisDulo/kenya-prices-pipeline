import { describe, expect, it } from "vitest";

import { parseInflation } from "../src/sources/inflation.js";

const row = (cells: string[], tag = "td") => `<tr>${cells.map((c) => `<${tag}>${c}</${tag}>`).join("")}</tr>`;
const HEADER = row(["Year", "Month", "Annual Average Inflation", "12-Month Inflation"], "th");

describe("parseInflation", () => {
  it("reads months, skipping the repeated header", () => {
    const { rows, rejects } = parseInflation(`<table>${HEADER}${HEADER}
      ${row(["2026", "October", "5.67", "7.32"])}${row(["2026", "September", "5.44", "6.76"])}</table>`);
    expect(rejects).toEqual([]);
    expect(rows).toEqual([
      { month: "2026-10-01", annualAveragePct: 5.67, twelveMonthPct: 7.32 },
      { month: "2026-09-01", annualAveragePct: 5.44, twelveMonthPct: 6.76 },
    ]);
  });

  it("keeps one copy of a repeated month with the same values", () => {
    const { rows, rejects } = parseInflation(`<table>${row(["2019", "May", "5.2", "6.0"])}${row(["2019", "May", "5.2", "6.0"])}</table>`);
    expect(rows).toHaveLength(1);
    expect(rejects[0].reason).toBe("exact duplicate");
  });

  it("drops a month published twice with different values", () => {
    const { rows, rejects } = parseInflation(`<table>${row(["2019", "May", "5.2", "6.0"])}${row(["2019", "May", "5.3", "6.1"])}</table>`);
    expect(rows).toEqual([]);
    expect(rejects[0].reason).toBe("conflicting duplicate");
  });

  it("rejects an unknown month or a missing rate", () => {
    const { rejects } = parseInflation(`<table>${row(["2026", "Smarch", "5", "6"])}${row(["2026", "June", "", "6"])}</table>`);
    expect(rejects.map((r) => r.reason)).toEqual(["invalid year or month", "rate missing or out of range"]);
  });
});
