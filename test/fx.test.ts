import { describe, expect, it } from "vitest";

import { kesPerUnit, normaliseLabel, parseFx } from "../src/sources/fx.js";

const TODAY = "2026-11-08";

/** Shaped like CBK's real file, including the quirks found in it. */
const CSV = [
  "11/10/2016,AE DIRHAM,27.5747,27.5449,27.6046",
  "08/10/2007,SINGAPORE $,45.3898,45.32899857,45.45059967",
  'Date,"US DOLLAR","STG POUND"',
  "01/10/2016,,",
  '2016-10-11,"KES / USHS",33.6379,33.5567,33.7191',
  '2016-10-11,"JPY (100)",97.7463,97.635,97.8577',
  '2016-10-11,"US DOLLAR",101.2,101.1,101.3',
  '2016-10-11,"US DOLLAR",101.2,101.1,101.3',
  '2018-06-25,"EURO",117.1056,116.9716667,117.2394444',
  '2018-06-25,"EURO",117.4556,117.3288889,117.5822222',
  '2038-01-22,"US DOLLAR",101.2,101.1,101.3',
  '2016-10-12,"MARS CREDIT",1,1,1',
  '2016-10-12,"US DOLLAR",101.2,101.5,101.3',
].join("\n");

describe("parseFx", () => {
  const { rows, rejects } = parseFx(CSV, TODAY);
  const reasons = rejects.map((r) => r.reason);

  it("reads both date formats, day first", () => {
    expect(rows.find((r) => r.currency === "AED")?.date).toBe("2016-10-11");
    expect(rows.find((r) => r.currency === "SGD")?.date).toBe("2007-10-08");
  });

  it("turns every quote into shillings per unit", () => {
    expect(rows.find((r) => r.currency === "UGX")?.kesPerUnit).toBeCloseTo(1 / 33.6379, 8);
    expect(rows.find((r) => r.currency === "JPY")?.kesPerUnit).toBeCloseTo(0.977463, 6);
    expect(rows.find((r) => r.currency === "USD")?.kesPerUnit).toBe(101.2);
  });

  it("drops the header row and blank rows inside the file", () => {
    expect(reasons).toContain("expected 5 columns");
  });

  it("keeps one copy of an exact duplicate", () => {
    expect(rows.filter((r) => r.currency === "USD" && r.date === "2016-10-11")).toHaveLength(1);
    expect(reasons).toContain("exact duplicate");
  });

  it("drops both copies when one day has two different rates", () => {
    expect(rows.some((r) => r.currency === "EUR")).toBe(false);
    expect(reasons.filter((r) => r === "conflicting duplicate")).toHaveLength(2);
  });

  it("refuses future dates, unknown currencies and out-of-order quotes", () => {
    expect(reasons).toEqual(expect.arrayContaining([
      "date in the future", "unknown currency MARS CREDIT", "buy, mean and sell out of order"]));
  });

  it("rejects a malformed line without losing the rest of the file", () => {
    const result = parseFx(['2016-10-11,"US DOLLAR"x,101.2,101.1,101.3', '2016-10-11,"EURO",110.5,110.4,110.6'].join("\n"), TODAY);
    expect(result.rejects.map((r) => r.reason)).toEqual(["malformed CSV line"]);
    expect(result.rows.map((r) => r.currency)).toEqual(["EUR"]);
  });

  it("loads exactly the rows that survive", () => {
    expect(rows.map((r) => r.currency).sort()).toEqual(["AED", "JPY", "SGD", "UGX", "USD"]);
  });
});

describe("currency labels", () => {
  it("treats differently spaced labels as one", () => {
    expect(normaliseLabel(" kes /ushs ")).toBe("KES/USHS");
    expect(normaliseLabel("KES / USHS")).toBe(normaliseLabel("KES/USHS"));
  });

  it("converts each quote direction", () => {
    expect(kesPerUnit(25, "units_per_kes")).toBe(0.04);
    expect(kesPerUnit(97, "kes_per_100")).toBe(0.97);
    expect(kesPerUnit(129.5, "kes_per_unit")).toBe(129.5);
  });
});
