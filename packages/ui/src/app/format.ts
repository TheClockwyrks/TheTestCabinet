// Display helpers. These format numbers for the gallery; they never derive a
// ranking or aggregate score, per the site's no-leaderboard constraint.

import type { RunMetrics } from "@test-cabinet/run-record";

// Add two nullable token counts, treating an unreported (null) category as zero
// because a harness that doesn't break the split out still folds those tokens into
// the category it does report. Null only when BOTH are unreported, so a genuinely
// empty total stays distinguishable from a real zero.
export function sumTokens(
  a: number | null,
  b: number | null,
): number | null {
  return a === null && b === null ? null : (a ?? 0) + (b ?? 0);
}

// Sum of every token category — the headline token figure shown on a card. An
// unreported category folds into the one it's accounted under (a cache-unaware
// harness reports all input as uncached; a harness that doesn't separate reasoning
// reports it within output), so it counts toward the total and the run still
// participates in token comparisons. Null only when no category is reported at all.
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

// A USD figure for display, or an em dash when it is unknown (null) — a run
// whose model prices could not be resolved, or a per-token price OpenRouter
// does not list. An unknown cost reads as "—" rather than a misleading $0.00.
export function formatUsd(value: number | null): string {
  if (value === null) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

// Scale a per-token price to a per-million-token figure for display, preserving
// an unknown (null) price instead of letting the multiplication turn it into 0.
export function perMillion(value: number | null): number | null {
  return value === null ? null : value * 1e6;
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
