// Display helpers. These format numbers for the gallery; they never derive a
// ranking or aggregate score, per the site's no-leaderboard constraint.

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

export function formatRunTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes === 0) {
    return `${rest}s`;
  }
  return `${minutes}m ${rest}s`;
}
