// Display helpers. These format numbers for the gallery; they never derive a
// ranking or aggregate score, per the site's no-leaderboard constraint.

import type { RunMetrics } from "@test-cabinet/run-record";

// Add two nullable token counts. Null when either is unknown, so a partial sum is
// never presented as if it were complete.
export function sumTokens(
  a: number | null,
  b: number | null,
): number | null {
  return a === null || b === null ? null : a + b;
}

// Sum of every token category — the headline token figure shown on a card. Null
// when any category is unreported (a harness that does not break out, say,
// reasoning tokens cannot have a meaningful total), so such runs are excluded from
// token comparisons rather than charted with an understated total.
export function totalTokens(metrics: RunMetrics): number | null {
  const { uncachedInput, cachedInput, output, reasoning } = metrics.tokens;
  return sumTokens(
    sumTokens(uncachedInput, cachedInput),
    sumTokens(output, reasoning),
  );
}

// A token count for display, or an em dash when the harness did not report it.
export function formatTokenCount(value: number | null): string {
  return value === null ? "—" : formatInteger(value);
}

// A compact token total for a card, or an em dash when it cannot be determined.
export function formatTokenTotal(metrics: RunMetrics): string {
  const total = totalTokens(metrics);
  return total === null ? "—" : formatCompact(total);
}

// Turn a kebab-case slug ("space-invaders") into a display title
// ("Space Invaders") for headings.
export function formatSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// A compact token figure for tight layouts: 552,960 -> "553k", 1,204,000 -> "1.2M".
export function formatCompact(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

// A release date for the model pages: an RFC 3339 timestamp rendered as a plain
// calendar date ("Oct 15, 2025"). The time of day OpenRouter records is noise
// here, so only the date is shown.
export function formatReleaseDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}

export function formatRunTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes === 0) {
    return `${rest}s`;
  }
  return `${minutes}m ${rest}s`;
}
