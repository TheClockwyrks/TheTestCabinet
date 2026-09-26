// Reading one code-analysis figure: what it is called, what it is measured in, whether
// it rests on approximation, and how it renders.
//
// Every answer here comes from `CODE_METRICS` — the generated mirror of the analyzer's
// own catalog — rather than from a list written beside the Code tab. That is the whole
// point of the catalog being data: the CLI report, this page's headers, the field sidebar
// and the docs page read one table, so a renamed field or a metric whose definition stops
// resolving cross-file references cannot end up labelled one way in the terminal and
// another way in the browser. A metric added to the summary appears here with its label,
// unit and `approximate` flag already correct.
//
// The rendering rules mirror `crates/cli/src/commands/analyze.rs` so the same figure reads
// the same in both places: a count is grouped, a mean keeps one decimal, a ratio is a
// percentage, a byte count is binary.

import type {
  RunRecord,
  ToolchainCoverage,
  ToolchainTests,
} from "@clockwyrks/run-record";
import { CODE_METRICS } from "@clockwyrks/run-record/code-metrics";
import type {
  CodeMetricDef,
  CodeMetricUnit,
} from "@clockwyrks/run-record/code-metrics";

/** The catalog entry for a dotted summary path (`"graph.cycles"`), or `undefined` when
 * the path carries no display metadata. */
export function codeMetric(path: string): CodeMetricDef | undefined {
  return CODE_METRICS.find((metric) => metric.path === path);
}

/**
 * Whether the figure at `path` rests on approximation rather than resolution.
 *
 * Read from the catalog, never asserted here. Cross-file reference counting is
 * approximate in both languages and worst exactly where this corpus lives — barrels,
 * namespace imports, bundler HTML entry points — and the honesty requirement is that the
 * page never states it more confidently than the analyzer does. An unknown path is
 * reported as *not* approximate, because the alternative (marking everything unknown as
 * approximate) would put a caveat on figures that do not need one and devalue the marker
 * where it is real.
 */
export function isApproximate(path: string): boolean {
  return codeMetric(path)?.approximate ?? false;
}

/** The marker shown beside an approximate figure, and the sentence that explains it.
 * One string each, so the table header, the chart caption and the tooltip agree. */
export const APPROXIMATE_MARK = "~";
export const APPROXIMATE_NOTE =
  "Approximate: dynamic imports, path aliases and bundler rewrites are not resolved.";

/**
 * Resolve a dotted catalog path against a serialized summary (or any nested object).
 *
 * A missing key and an explicit `null` are the same answer — the metric has no value in
 * this tree — because that is exactly what an absent language block looks like: a
 * pure-Rust tree carries no `typescript` block at all, and rendering "TypeScript files:
 * 0" for it would be noise dressed as a measurement.
 */
export function lookupMetric(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current ?? undefined;
}

const grouped = new Intl.NumberFormat("en-US");

/** A number: whole values grouped into thousands, fractional ones to one decimal. A mean
 * of `2.4` and a count of `66,258` are read very differently, and rendering the count as
 * `66258.0` or the mean as `2` would each lose the distinction. */
export function formatCodeNumber(value: number): string {
  return Number.isInteger(value) ? grouped.format(value) : value.toFixed(1);
}

/** A byte count in binary units, matching the CLI's report. */
export function formatCodeBytes(value: number): string {
  const units = ["B", "KiB", "MiB", "GiB"];
  let scaled = value;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  return unit === 0
    ? `${grouped.format(value)} B`
    : `${scaled.toFixed(1)} ${units[unit]}`;
}

/**
 * Format one metric's value for its unit.
 *
 * Returns `null` for a value the unit cannot describe, which keeps a catalog/summary
 * mismatch off the page rather than rendering `null` at the reader.
 */
export function formatMetricValue(
  value: unknown,
  unit: CodeMetricUnit,
): string | null {
  if (unit === "boolean") {
    return typeof value === "boolean" ? (value ? "yes" : "no") : null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  switch (unit) {
    case "bytes":
      return formatCodeBytes(value);
    case "ratio":
      return `${(value * 100).toFixed(1)}%`;
    case "perKiloLine":
      return `${value.toFixed(1)}/kloc`;
    case "count":
    case "lines":
    case "score":
      return formatCodeNumber(value);
  }
}

/**
 * The human heading for a catalog family.
 *
 * Only the families whose own name does not read as a heading are renamed; anything else
 * — including a family added to the catalog later — falls through to its own name rather
 * than being dropped, so a new family appears on this page before anyone remembers to
 * name it here. Mirrors the CLI's `family_heading` for the same reason the value
 * formatting mirrors its counterpart: two reports of one analysis should not disagree
 * about what a section is called.
 *
 * Two of the renames are corrections rather than tidying, and both exist because this
 * page now also carries EXECUTED figures. `notes` was headed "Coverage", which it never
 * was: its rows are the walk's own diagnostics (what it truncated, what it skipped, what
 * it refused), and that heading collided with both the console's Coverage feature area
 * and, now, with real code coverage. `tests` was headed "Tests", which is a heading the
 * executed suite has a much better claim to — the rows under it are static counts of how
 * much test code the model *wrote*, an authorship signal the analyzer's own contract says
 * must never be presented as coverage. "Test authorship" says which of the two tiers a
 * reader is looking at without having to know that one of them ran.
 */
export function familyHeading(family: string): string {
  switch (family) {
    case "size":
      return "Size and shape";
    case "graph":
      return "Module graph";
    case "api":
      return "Public API";
    case "typescript":
      return "TypeScript discipline";
    case "rust":
      return "Rust discipline";
    case "complexity":
      return "Complexity";
    case "tests":
      return "Test authorship";
    case "duplication":
      return "Duplication";
    case "notes":
      return "Analysis notes";
    case "provenance":
      return "Provenance";
    default:
      return family;
  }
}

/** One rendered figure: what to call it, what it says, and whether it carries the
 * approximate marker. */
export interface CodeFigure {
  path: string;
  label: string;
  value: string;
  approximate: boolean;
}

/** Every catalog family that has at least one resolvable figure in `summary`, in catalog
 * order — which is ordered by how much a reader wants the figure, so rendering it in
 * order already produces a sensible page. */
export function codeFigureFamilies(
  summary: unknown,
): { family: string; figures: CodeFigure[] }[] {
  const families: { family: string; figures: CodeFigure[] }[] = [];
  for (const metric of CODE_METRICS) {
    const raw = lookupMetric(summary, metric.path);
    if (raw === undefined) continue;
    const value = formatMetricValue(raw, metric.unit);
    if (value === null) continue;
    const figure: CodeFigure = {
      path: metric.path,
      label: metric.label,
      value,
      approximate: metric.approximate,
    };
    const existing = families.find((f) => f.family === metric.family);
    if (existing) existing.figures.push(figure);
    else families.push({ family: metric.family, figures: [figure] });
  }
  return families;
}

/**
 * The runner's own report, when this run's case wrote one — otherwise `null`.
 *
 * This is the ONLY gate on the Tests widget. It is deliberately a test of whether
 * file-derived data was actually parsed, not of whether the manifest declared a `test`
 * command: a case that declares one but whose vitest config still writes only a terminal
 * table produces no report file, and must therefore show nothing at all rather than an
 * empty widget. Every case version predating the report-file contract fails this test for
 * free.
 *
 * What it returns describes the MODEL'S OWN suite — the `build` vitest project, whose
 * `include` is `src/**` and whose tests the model wrote. The test case's validators are a
 * different vitest project entirely, run by a different code path, and nothing they do
 * reaches this block.
 */
export function toolchainTests(run: RunRecord): ToolchainTests | null {
  return run.toolchain?.test?.tests ?? null;
}

/**
 * What the coverage reporter measured, when one wrote a summary — otherwise `null`.
 *
 * Gated separately from the tests, because the two come from two files: a config that
 * writes a test report but no coverage summary shows the Tests widget and no Coverage
 * widget. Like {@link toolchainTests}, this is coverage of the code the MODEL wrote by the
 * tests the MODEL wrote; the validators' own project has coverage disabled by design and
 * could not contribute to it even if it were asked to.
 */
export function toolchainCoverage(run: RunRecord): ToolchainCoverage | null {
  return run.toolchain?.test?.coverage ?? null;
}

/**
 * How long one recorded test took, as the runner timed it — or `null` when it did not.
 *
 * An absent duration is NOT TIMED, never zero: the runner reports none for a test it
 * never ran, and rendering that as `0 ms` would claim a measurement the report does not
 * carry. A recorded zero IS a measurement and formats as one.
 *
 * The scale follows the figure: seconds past a second and whole milliseconds below it,
 * with a decimal kept on a fractional sub-ten-millisecond figure so a test the runner
 * timed at 0.4 ms does not read as having taken no time at all.
 */
export function formatTestDuration(ms: number | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
  if (ms >= 10000) return `${Math.round(ms / 1000)} s`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms >= 10 || Number.isInteger(ms)) return `${Math.round(ms)} ms`;
  return `${ms.toFixed(1)} ms`;
}
