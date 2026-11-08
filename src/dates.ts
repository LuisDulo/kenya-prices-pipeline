/** Date helpers that work on plain YYYY-MM-DD strings, so no time zone can shift a day. */

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december"];

function iso(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return valid ? date.toISOString().slice(0, 10) : null;
}

/** Day-first dates such as 15-10-2026 or 04/01/2024, and ISO dates. Anything else is null. */
export function parseDate(text: string): string | null {
  const value = text.trim().replace(/^"|"$/g, "");
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) return iso(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value);
  if (match) return iso(Number(match[3]), Number(match[2]), Number(match[1]));
  return null;
}

export function monthStart(year: number, monthName: string): string | null {
  const month = MONTHS.indexOf(monthName.trim().toLowerCase()) + 1;
  return month ? iso(year, month, 1) : null;
}

/** Today in Nairobi, where every source publishes. */
export function todayInNairobi(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(now);
}
