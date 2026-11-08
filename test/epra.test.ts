import { describe, expect, it } from "vitest";

import { parseEpra } from "../src/sources/epra.js";

const HEADER = "<tr><th>From</th><th>To</th><th>Town</th><th>Super (PMS)</th><th>Diesel (AGO)</th><th>Kerosene (IK)</th></tr>";
const row = (cells: string[]) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
const page = (...rows: string[]) => `<html><body><div>FUEL PRICE INDEX</div><table>${HEADER}${rows.join("")}</table></body></html>`;

describe("parseEpra", () => {
  it("turns each town row into one price per fuel", () => {
    const { rows, rejects } = parseEpra(page(row(["15-10-2026", "14-11-2026", " Nairobi ", "226.96", "227.76", "219.87"])));
    expect(rejects).toEqual([]);
    expect(rows).toEqual([
      { cycleStart: "2026-10-15", cycleEnd: "2026-11-14", town: "Nairobi", product: "PMS", priceKes: 226.96 },
      { cycleStart: "2026-10-15", cycleEnd: "2026-11-14", town: "Nairobi", product: "AGO", priceKes: 227.76 },
      { cycleStart: "2026-10-15", cycleEnd: "2026-11-14", town: "Nairobi", product: "IK", priceKes: 219.87 },
    ]);
  });

  it("skips a fuel with no price but keeps the others", () => {
    const { rows } = parseEpra(page(row(["15-10-2026", "14-11-2026", "Lodwar", "240.10", "241.00", "-"])));
    expect(rows.map((r) => r.product)).toEqual(["PMS", "AGO"]);
  });

  it("rejects impossible dates and implausible prices", () => {
    const { rows, rejects } = parseEpra(page(
      row(["31-02-2026", "14-03-2026", "Nakuru", "200", "200", "200"]),
      row(["15-10-2026", "14-11-2026", "Kisumu", "2265.10", "227.00", "219.00"]),
    ));
    expect(rejects.map((r) => r.reason)).toEqual(["invalid cycle dates", "PMS price out of range: 2265.10"]);
    expect(rows.map((r) => r.product)).toEqual(["AGO", "IK"]);
  });

  it("keeps one copy of a town listed twice with the same prices", () => {
    const { rows, rejects } = parseEpra(page(
      row(["15-10-2026", "14-11-2026", "Kisumu", "226.51", "227.71", "219.83"]),
      row(["15-10-2026", "14-11-2026", "kisumu", "226.51", "227.71", "219.83"]),
    ));
    expect(rows).toHaveLength(3);
    expect(rejects.map((r) => r.reason)).toEqual(["exact duplicate"]);
  });

  it("drops both copies of a town listed twice with different prices", () => {
    const { rows, rejects } = parseEpra(page(
      row(["15-10-2026", "14-11-2026", "Kisumu", "226.51", "227.71", "219.83"]),
      row(["15-10-2026", "14-11-2026", "Kisumu", "230.00", "227.71", "219.83"]),
    ));
    expect(rows).toEqual([]);
    expect(rejects.map((r) => r.reason)).toEqual(["conflicting duplicate", "conflicting duplicate"]);
  });

  it("fails loudly when the page layout changes", () => {
    expect(() => parseEpra("<html><body>Maintenance</body></html>")).toThrow(/no price table/);
    expect(() => parseEpra("<table><tr><th>Town</th><th>Price</th></tr></table>")).toThrow(/columns changed/);
  });
});
