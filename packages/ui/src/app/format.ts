// Display helpers. These format numbers for the gallery; they don't compute
// rankings or aggregate scores themselves — that's the leaderboard's job.

import type { RunMetrics } from "@test-cabinet/run-record";
import type { RunScoreOut } from "@test-cabinet/run-record/snapshot";
import { formatPoints as formatPointValue } from "../ratings";

// Add two nullable token counts, treating an unreported (null) category as zero
// because a harness that doesn't break the split out still folds those tokens into
// the category it does report. Null only when BOTH are unreported, so a genuinely
// empty total stays distinguishable from a real zero.
export function sumTokens(a: number | null, b: number | null): number | null {
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
  // Sub-dollar figures (per-token prices, tiny run costs) need the extra
  // precision to read as anything but "$0.00"; at a dollar and up those digits
  // are just noise, so cap them at cents.
  const fractionDigits = Math.abs(value) < 1 ? 4 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

// A compact USD figure for a stat tile: 48230.55 -> "$48.2K", 1204000 -> "$1.2M".
// The one significant decimal keeps a headline figure readable where formatUsd's
// cent precision would be noise. An unknown (null) figure reads as an em dash,
// like formatUsd's, rather than a misleading $0.
export function formatUsdCompact(value: number | null): string {
  if (value === null) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

// A run's aggregate reviewer score as "earned / total" (e.g. "12.5 / 20") — the
// mean weight its reviews awarded over the points available. Review items are
// integer-weighted, so a whole earned figure shows no ".0" ("12 / 20", never
// "12.0 / 20"); a genuinely fractional mean (it averages across reviews) keeps
// its non-zero decimals, trimmed by the same shared rule every other points
// figure uses (`formatPoints` in ratings.ts). The total is a whole point count.
// An em dash when the run has no reviews (null score).
export function formatPoints(score: RunScoreOut | null): string {
  if (score === null) {
    return "—";
  }
  return `${formatPointValue(score.earned)} / ${score.total}`;
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

// A run's start time for a dense table cell: calendar date + 24h local time
// ("Jul 6, 2026, 14:05"). An unparseable timestamp reads as an em dash.
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

// A run's age for a caption ("3h ago"): the distance from `now` in its largest
// whole unit, "just now" under a minute. Days cap the calendar-free units —
// beyond them the figure approximates ("mo" is 30 days, "y" 365) — because a
// caption wants a rough age, not an anniversary. An unparseable timestamp reads
// as an em dash. `now` is injectable so callers and tests stay off the wall
// clock.
export function formatTimeAgo(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return "—";
  }
  const seconds = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
