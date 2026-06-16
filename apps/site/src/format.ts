// Display helpers. These format numbers for the gallery; they never derive a
// ranking or aggregate score, per the site's no-leaderboard constraint.

import type { RunMetrics } from "@test-cabinet/run-record";

// Sum of every token category — the headline token figure shown on a card.
export function totalTokens(metrics: RunMetrics): number {
  const { uncachedInput, cachedInput, output, reasoning } = metrics.tokens;
  return uncachedInput + cachedInput + output + reasoning;
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
