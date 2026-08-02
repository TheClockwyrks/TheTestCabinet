// The outliers: the specific things a summary figure cannot name.
//
// "Mean cyclomatic complexity 4.1" describes a tree; "`resolveCollision` scores 41"
// describes a decision. These two rankings are where a reader goes once a figure above
// tells them something is off, so both are ranked by the measure that made them
// interesting and both carry the location in the tooltip.
//
// Horizontal bars, because the categories are function names and file paths — long,
// variable-length strings that a vertical axis would tilt 40 degrees and clip. Turned on
// its side, the label reads at full length and the eye runs down a list, which is what a
// ranking is. One hue, because length already carries the magnitude.

import { Chart, horizontalBarChart } from "@test-cabinet/ui";
import type { CodeAnalysisDocument } from "@test-cabinet/run-record/code-analysis";
import { formatCodeNumber } from "./codeFormat";
import styles from "./CodePanels.module.scss";

/** How many rows each ranking shows. Enough to see a shape and a tail; short enough that
 * every bar keeps a readable label. */
const TOP_N = 12;

function basename(path: string): string {
  const at = path.lastIndexOf("/");
  return at >= 0 ? path.slice(at + 1) : path;
}

/**
 * Unique labels for a function ranking.
 *
 * A bar chart's categories are its band domain, so two bars sharing a label would merge
 * into one and misstate both values. Model-written trees repeat function names constantly
 * (`update`, `draw`, `reset`), so a repeated name is qualified with where it lives —
 * file and line, which is unique per symbol by construction. A name that appears once is
 * left alone: qualifying every row would cost the readability the horizontal form was
 * chosen for.
 */
function functionLabels(
  document: CodeAnalysisDocument,
  symbols: readonly { name: string; file: number; line: number }[],
): string[] {
  const counts = new Map<string, number>();
  for (const symbol of symbols) {
    counts.set(symbol.name, (counts.get(symbol.name) ?? 0) + 1);
  }
  return symbols.map((symbol) => {
    if ((counts.get(symbol.name) ?? 0) <= 1) return symbol.name;
    const path = document.files[symbol.file]?.path ?? "?";
    return `${symbol.name} · ${basename(path)}:${symbol.line}`;
  });
}

export function CodeOutliers({
  document: analysis,
}: {
  document: CodeAnalysisDocument;
}) {
  // The same total order the CLI report and the symbol table use, so all three name the
  // same worst function rather than three that happened to tie.
  const worst = [...analysis.symbols]
    .sort(
      (a, b) =>
        b.cyclomatic - a.cyclomatic ||
        b.cognitive - a.cognitive ||
        a.file - b.file ||
        a.line - b.line,
    )
    .slice(0, TOP_N);
  const worstLabels = functionLabels(analysis, worst);
  const functionBars = worst.map((symbol, index) => ({
    label: worstLabels[index]!,
    value: symbol.cyclomatic,
    title: [
      `${symbol.name} — ${analysis.files[symbol.file]?.path ?? "?"}:${symbol.line}`,
      `cyclomatic ${symbol.cyclomatic} · cognitive ${symbol.cognitive}`,
      `${symbol.lines} lines · nesting ${symbol.maxNesting} · ${symbol.parameters} parameters`,
    ].join("\n"),
  }));

  const largest = [...analysis.files]
    // A file with no code lines has no bar to draw, so it is dropped rather than shown
    // as a zero-length row. It only ever reaches the chart on a *short* ranking — the
    // sort sinks empty files past the cap by itself whenever there are TOP_N non-empty
    // ones — which is why the filter is not redundant with it: a run whose model
    // scaffolded a pile of empty files and wrote few real ones is precisely the tree
    // where the ranking has room left over.
    .filter((file) => file.codeLines > 0)
    .sort((a, b) => b.codeLines - a.codeLines || (a.path < b.path ? -1 : 1))
    .slice(0, TOP_N);
  const fileBars = largest.map((file) => ({
    // Paths are unique in the document, so they need no qualification — but the full path
    // is what makes a bar identifiable, and the chart's left margin grows to hold it.
    label: file.path,
    value: file.codeLines,
    title: [
      file.path,
      `${file.codeLines} code lines · ${file.functions} functions`,
      `imports ${file.fanOut} · imported by ${file.fanIn}`,
    ].join("\n"),
  }));

  if (functionBars.length === 0 && fileBars.length === 0) return null;

  return (
    <div className={styles.outliers}>
      {functionBars.length > 0 && (
        <figure className={styles.outlier}>
          <figcaption className={styles.outlierTitle}>
            Most complex functions
            <span className={styles.outlierNote}>
              McCabe cyclomatic complexity
            </span>
          </figcaption>
          <Chart
            title="Most complex functions, by cyclomatic complexity"
            spec={(palette) =>
              horizontalBarChart(functionBars, palette, {
                valueLabel: formatCodeNumber,
              })
            }
          />
        </figure>
      )}
      {fileBars.length > 0 && (
        <figure className={styles.outlier}>
          <figcaption className={styles.outlierTitle}>
            Largest files
            <span className={styles.outlierNote}>code lines</span>
          </figcaption>
          <Chart
            title="Largest files, by code lines"
            spec={(palette) =>
              horizontalBarChart(fileBars, palette, {
                valueLabel: formatCodeNumber,
              })
            }
          />
        </figure>
      )}
    </div>
  );
}
