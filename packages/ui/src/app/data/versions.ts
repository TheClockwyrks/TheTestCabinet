// Version parsing and ordering, shared by everything that compares a test case's
// versions: the version-scope control on the Metrics/Leaderboard tabs, the run
// listings' version facet, and the summary query's current-version filter.
//
// A version is a `v<major>.<minor>.<revision>` directory name (e.g. `v1.2.0`).
// There is no semver dependency on purpose — these mirror the catalog's own
// `version_key` in `crates/core/src/test_case.rs`, so a version orders the same way
// on the filesystem, in the backend's SQL-backed listings, and in the browser.

/** A version's numeric parts, as {@link parseVersion} reads them. */
export interface Semver {
  major: number;
  minor: number;
  revision: number;
}

/**
 * Parse a `v1.2.0`-style version into its numeric parts, or null when it does not
 * match that shape. **Strict**: a caller that gets null should fall back to an
 * exact string compare, so a malformed value only ever matches its own kind rather
 * than silently joining some other version's cohort.
 *
 * This is the right tool for comparing two *catalog* versions the UI already
 * holds. For ordering (and for the cohort key the run listings share with the
 * backend) use {@link versionKey} / {@link majorMinorKey}, which are tolerant in
 * exactly the way the Rust catalog is.
 */
export function parseVersion(version: string): Semver | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    revision: Number(match[3]),
  };
}

/**
 * A comparable key for a version string, so versions order **component-wise**
 * rather than lexically — `v1.10.0` is newer than `v1.9.0`, which a string
 * compare gets backwards.
 *
 * A leading `v` is ignored, dot-separated components compare numerically, and any
 * non-numeric tail of a component is ignored (a component with no leading digits
 * reads as `0`). Deliberately mirrors the Rust catalog's `version_key`, down to
 * that tolerance, so the two hosts of a run listing agree on every input.
 */
export function versionKey(version: string): number[] {
  return version
    .replace(/^v/, "")
    .split(".")
    .map((part) => Number(/^\d*/.exec(part)?.[0] ?? "") || 0);
}

/** Compare two numeric keys component-wise, treating a missing component as 0. */
function compareKeys(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Order two versions oldest-first by {@link versionKey}, falling back to a string
 * compare so versions with equal numeric keys still order deterministically.
 */
export function compareVersions(a: string, b: string): number {
  const diff = compareKeys(versionKey(a), versionKey(b));
  if (diff !== 0) return diff;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A version's `major.minor` as a comparable string key — the granularity a *spec*
 * changes at. Two versions sharing it are the same spec at different revisions
 * (`v1.2.0` and `v1.2.1`), so a run of either is comparable with a run of the
 * other; a different key is a different spec.
 */
export function majorMinorKey(version: string): string {
  const key = versionKey(version);
  return `${key[0] ?? 0}.${key[1] ?? 0}`;
}

/**
 * The **current** `major.minor` key among `versions` — the greatest one present —
 * or null when there are none.
 */
export function currentMajorMinor(versions: Iterable<string>): string | null {
  let best: string | null = null;
  let bestKey: number[] = [];
  for (const version of versions) {
    const key = versionKey(version).slice(0, 2);
    if (best === null || compareKeys(key, bestKey) > 0) {
      best = majorMinorKey(version);
      bestKey = key;
    }
  }
  return best;
}
