// What the model's own tests reached in the model's own code.
//
// Read from `coverage/coverage-summary.json`, which istanbul wrote during the same
// invocation the Tests widget above reports. The measured set is what the build vitest
// config's `coverage.include` names — `src/**/*.ts`, minus the tests themselves and,
// in an engine workspace, minus the two files the workspace seeded and forbade the build
// to edit — so the denominator is the code the model wrote and nothing else.
//
// **These are not the test case's validators.** The validators are a separate vitest
// project whose config sets `coverage: { enabled: false }`, deliberately, because a
// grader's own suite cannot flatter the build's coverage. Nothing they execute is
// measured here, and no figure on this widget would move if they were deleted.
//
// All four istanbul metrics are shown rather than one headline percentage, because they
// disagree in the way that matters: a suite that calls every function once and takes no
// `else` reads as well-covered on lines and badly on branches, and a single number would
// report only whichever of the two the reader happened to be shown. The ranking is a
// chart, so its table twin below lists every measured file with the same four figures —
// nothing on this widget is reachable only by hovering a bar.
//
// Nothing here is a score. Coverage gates no rating, no verdict and no point.

import { Chart, ProgressBar, horizontalBarChart } from "@test-cabinet/ui";
import type {
  CoverageFile as CoverageFileRow,
  ToolchainCoverage as ToolchainCoverageRecord,
} from "@test-cabinet/run-record";
import { formatCodeNumber } from "./codeFormat";
import {
  COVERAGE_METRIC_KEYS,
  COVERAGE_METRIC_META,
  coveragePercent,
  formatCoveragePercent,
} from "./coverageJoin";
import styles from "./CodePanels.module.scss";

/** How many rows the least-covered ranking shows. The same cap the tab's other rankings
 * use, for the same reason: enough to see a shape and a tail, short enough that every bar
 * keeps a readable path label. */
const TOP_N = 12;

export function ToolchainCoverage({
  coverage,
}: {
  coverage: ToolchainCoverageRecord;
}) {
  // A file istanbul measured but found no executable lines in has no coverage to rank —
  // it is not a zero-percent file, it is an unmeasurable one — so it is dropped from the
  // chart while staying in the table, where the em dash says so.
  const rankable: { file: CoverageFileRow; pct: number }[] = [];
  for (const file of coverage.files) {
    const pct = coveragePercent(file.lines);
    if (pct === null) continue;
    rankable.push({ file, pct });
  }
  // Worst first, with the path as a total tie-break so a tree whose files all sit at the
  // same percentage ranks identically on every render.
  rankable.sort(
    (a, b) => a.pct - b.pct || (a.file.path < b.file.path ? -1 : 1),
  );

  const bars = rankable.slice(0, TOP_N).map(({ file, pct }) => ({
    // Paths are unique in the report, so they need no qualification, and the full path is
    // what makes a bar identifiable.
    label: file.path,
    value: pct,
    title: [
      file.path,
      ...COVERAGE_METRIC_KEYS.map(
        (key) =>
          `${COVERAGE_METRIC_META[key].label.toLowerCase()} ${formatCoveragePercent(coveragePercent(file[key]))} (${formatCodeNumber(file[key].covered)}/${formatCodeNumber(file[key].total)})`,
      ),
    ].join("\n"),
  }));

  return (
    <div className={styles.toolchain}>
      <div className={styles.coverageMetrics}>
        {COVERAGE_METRIC_KEYS.map((key) => {
          const metric = coverage.totals[key];
          const pct = coveragePercent(metric);
          const meta = COVERAGE_METRIC_META[key];
          return (
            <div key={key} className={styles.coverageMetric}>
              <span className={styles.provenanceLabel}>{meta.label}</span>
              <span className={styles.coverageValue}>
                {formatCoveragePercent(pct)}
              </span>
              {/* The bar restates the percentage it sits under; it is never the only
                  statement of it, so a reader who cannot resolve a thin fill still has
                  the figure and the counts. A metric with nothing to measure draws no
                  bar at all — an empty track reads as zero percent, and a file with no
                  branches has not failed to cover its branches. */}
              {pct !== null && (
                <ProgressBar
                  value={pct / 100}
                  ariaLabel={`${meta.label} coverage`}
                />
              )}
              <span className={styles.coverageCounts}>
                {formatCodeNumber(metric.covered)} of{" "}
                {formatCodeNumber(metric.total)} {meta.note}
              </span>
            </div>
          );
        })}
      </div>

      {bars.length > 0 && (
        <figure className={styles.outlier}>
          <figcaption className={styles.outlierTitle}>
            Least covered files
            <span className={styles.outlierNote}>
              line coverage, the model&rsquo;s own source
            </span>
          </figcaption>
          <Chart
            title="Least covered files, by line coverage"
            spec={(palette) =>
              horizontalBarChart(bars, palette, {
                valueLabel: (value) => `${value.toFixed(1)}%`,
              })
            }
          />
        </figure>
      )}

      {coverage.files.length > 0 && (
        <div className={styles.toolchainCard}>
          <table className={styles.table}>
            <caption className={styles.tableCaption}>
              {formatCodeNumber(coverage.filesMeasured)}{" "}
              {coverage.filesMeasured === 1 ? "file" : "files"} measured, each
              with the share its tests reached and the counts behind it
            </caption>
            <thead>
              <tr>
                <th scope="col">File</th>
                {COVERAGE_METRIC_KEYS.map((key) => (
                  <th key={key} scope="col" className={styles.numeric}>
                    {COVERAGE_METRIC_META[key].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {coverage.files.map((file) => (
                <tr key={file.path}>
                  <th scope="row">{file.path}</th>
                  {COVERAGE_METRIC_KEYS.map((key) => (
                    <td key={key} className={styles.numeric}>
                      <span className={styles.covCell}>
                        <span>
                          {formatCoveragePercent(coveragePercent(file[key]))}
                        </span>
                        <span className={styles.covCounts}>
                          {formatCodeNumber(file[key].covered)}/
                          {formatCodeNumber(file[key].total)}
                        </span>
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {coverage.filesTruncated && (
            <p className={styles.caveat}>
              The per-file list was capped at {coverage.files.length} of{" "}
              {formatCodeNumber(coverage.filesMeasured)} measured files; the
              totals above it cover all of them.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
