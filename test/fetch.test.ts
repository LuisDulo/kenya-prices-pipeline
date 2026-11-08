import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { parseDate, todayInNairobi } from "../src/dates.js";
import { clearRobotsCache, politeFetch, robotsAllows, USER_AGENT } from "../src/fetch.js";

const ROBOTS = "User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n\nUser-agent: BadBot\nDisallow: /";

describe("robotsAllows", () => {
  it("applies the rules for every user agent, longest match first", () => {
    expect(robotsAllows(ROBOTS, "/pump-prices")).toBe(true);
    expect(robotsAllows(ROBOTS, "/wp-admin/options.php")).toBe(false);
    expect(robotsAllows(ROBOTS, "/wp-admin/admin-ajax.php")).toBe(true);
  });

  it("treats * as a wildcard, not as the end of the rule", () => {
    // From EPRA's real robots.txt. Cutting the pattern at "*" turned it into "Disallow: /".
    const epra = "User-agent: *\nAllow: /core/*.css$\nDisallow: /core/\nDisallow: /*/media/oembed\nDisallow: /admin/";
    expect(robotsAllows(epra, "/pump-prices")).toBe(true);
    expect(robotsAllows(epra, "/en/media/oembed")).toBe(false);
    expect(robotsAllows(epra, "/core/theme.css")).toBe(true);
    expect(robotsAllows(epra, "/core/theme.css?v=2")).toBe(false);
    expect(robotsAllows(epra, "/admin/settings")).toBe(false);
  });

  it("ignores rules written for another bot", () => {
    expect(robotsAllows("User-agent: BadBot\nDisallow: /", "/anything")).toBe(true);
  });
});

function fakeFetch(responses: (Response | Error)[], robots = "") {
  const calls: { url: string; agent: string | null }[] = [];
  const impl = async (url: string, init?: RequestInit) => {
    calls.push({ url, agent: new Headers(init?.headers).get("User-Agent") });
    if (url.endsWith("/robots.txt")) return new Response(robots, { headers: { "content-type": "text/plain" } });
    const next = responses.shift()!;
    if (next instanceof Error) throw next;
    return next;
  };
  return { impl, calls };
}

describe("politeFetch", () => {
  beforeEach(() => clearRobotsCache());
  const noWait = async () => undefined;

  it("identifies itself and saves what it downloads", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "fetch-"));
    const { impl, calls } = fakeFetch([new Response("<table></table>")]);
    const body = await politeFetch("https://site.test/prices", { fetchImpl: impl, sleep: noWait, cacheDir: dir, cacheName: "x.html" });
    expect(body).toBe("<table></table>");
    expect(calls.every((c) => c.agent === USER_AGENT)).toBe(true);
    expect(await readFile(path.join(dir, "x.html"), "utf8")).toBe("<table></table>");
  });

  it("retries a server error and a dropped connection, then succeeds", async () => {
    const { impl } = fakeFetch([new Response("", { status: 503 }), new Error("socket hang up"), new Response("ok")]);
    expect(await politeFetch("https://site.test/p", { fetchImpl: impl, sleep: noWait })).toBe("ok");
  });

  it("gives up after its retries", async () => {
    const { impl } = fakeFetch(Array.from({ length: 4 }, () => new Response("", { status: 500 })));
    await expect(politeFetch("https://site.test/p", { fetchImpl: impl, sleep: noWait, retries: 3 })).rejects.toThrow(/after 4 attempts/);
  });

  it("does not retry a page that does not exist", async () => {
    const { impl, calls } = fakeFetch([new Response("", { status: 404 })]);
    await expect(politeFetch("https://site.test/p", { fetchImpl: impl, sleep: noWait })).rejects.toThrow(/404/);
    expect(calls.filter((c) => !c.url.endsWith("robots.txt"))).toHaveLength(1);
  });

  it("refuses a path robots.txt disallows", async () => {
    const { impl } = fakeFetch([], "User-agent: *\nDisallow: /private");
    await expect(politeFetch("https://site.test/private/x", { fetchImpl: impl, sleep: noWait })).rejects.toThrow(/robots/);
  });
});

describe("dates", () => {
  it("parses ISO and day-first dates and refuses impossible ones", () => {
    expect(parseDate("2024-01-03")).toBe("2024-01-03");
    expect(parseDate("04/01/2024")).toBe("2024-01-04");
    expect(parseDate("15-10-2026")).toBe("2026-10-15");
    expect(parseDate("31-02-2026")).toBeNull();
    expect(parseDate("Date")).toBeNull();
  });

  it("uses the Nairobi calendar day", () => {
    expect(todayInNairobi(new Date("2026-11-07T22:30:00Z"))).toBe("2026-11-08");
  });
});
