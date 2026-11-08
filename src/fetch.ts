import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const USER_AGENT = "kenya-prices-pipeline/0.1 (+https://github.com/LuisDulo/kenya-prices-pipeline)";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface FetchOptions {
  fetchImpl?: FetchLike;
  retries?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  cacheDir?: string;
  cacheName?: string;
}

/** A robots.txt path pattern as a regular expression: "*" is any text and a final "$" ends it. */
function patternToRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/**
 * The rules for every user agent in a robots.txt file, following RFC 9309: the most specific
 * (longest) matching rule wins, and on a tie Allow wins.
 */
export function robotsAllows(robots: string, pathname: string): boolean {
  let applies = false;
  const rules: { allow: boolean; pattern: string }[] = [];
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const [field, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (/^user-agent$/i.test(field)) applies = value === "*";
    else if (applies && /^(dis)?allow$/i.test(field) && value) {
      rules.push({ allow: /^allow$/i.test(field), pattern: value });
    }
  }
  const match = rules
    .filter((rule) => patternToRegex(rule.pattern).test(pathname))
    .sort((a, b) => b.pattern.length - a.pattern.length || Number(b.allow) - Number(a.allow))[0];
  return match ? match.allow : true;
}

const robotsCache = new Map<string, string>();
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function attempt(url: string, options: Required<Pick<FetchOptions, "fetchImpl" | "timeoutMs">>) {
  return options.fetchImpl(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(options.timeoutMs),
  });
}

/** Fetch a page as a polite client: identify ourselves, obey robots.txt, retry with backoff. */
export async function politeFetch(url: string, options: FetchOptions = {}): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const retries = options.retries ?? 3;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const sleep = options.sleep ?? wait;
  const { origin, pathname } = new URL(url);

  if (!robotsCache.has(origin)) {
    const response = await attempt(`${origin}/robots.txt`, { fetchImpl, timeoutMs }).catch(() => null);
    const isText = response?.ok && (response.headers.get("content-type") ?? "").startsWith("text/plain");
    robotsCache.set(origin, isText ? await response!.text() : "");
  }
  if (!robotsAllows(robotsCache.get(origin)!, pathname)) {
    throw new Error(`robots.txt does not allow ${url}`);
  }

  let lastError: unknown;
  for (let tryNumber = 0; tryNumber <= retries; tryNumber++) {
    if (tryNumber > 0) await sleep(1000 * 2 ** tryNumber);
    try {
      const response = await attempt(url, { fetchImpl, timeoutMs });
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`${url} answered ${response.status}`);
        continue;
      }
      if (!response.ok) throw new Error(`${url} answered ${response.status}`);
      const body = await response.text();
      if (options.cacheDir && options.cacheName) {
        await mkdir(options.cacheDir, { recursive: true });
        await writeFile(path.join(options.cacheDir, options.cacheName), body);
      }
      return body;
    } catch (error) {
      if (error instanceof Error && /answered 4\d\d/.test(error.message) && !/429/.test(error.message)) throw error;
      lastError = error;
    }
  }
  throw new Error(`Could not fetch ${url} after ${retries + 1} attempts: ${String(lastError)}`);
}

export function clearRobotsCache() {
  robotsCache.clear();
}
