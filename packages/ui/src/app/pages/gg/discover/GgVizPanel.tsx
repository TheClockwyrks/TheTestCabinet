// The **visualization panel** — the chart (or the stat tiles) above Discover's
// bucket table.
//
// It renders whatever `chooseVisualizations` decided; the interesting decisions all
// live there. What lives here is the framing, and two rules that make the framing
// honest:
//
// - **The table below is always reachable, and this panel never replaces it.** A
//   chart drops what it cannot draw — an absent value, a bucket past the cap, a
//   series past the palette — so the numbers behind it have to stay one scroll away.
//   That also discharges the light-mode contrast WARN on the categorical palette,
//   which the dataviz validator says is relieved by "visible labels or a table view".
// - **Whatever a chart declined to draw is printed under its title**, as a count of
//   rows rather than a shrug. A chart that quietly shows a subset is worse than one
//   that says which subset.
//
// Every figure reads its surface, text, border and accent from the live `--tcab-*`
// custom properties at plot time (`readChartPalette`), so the same component draws
// correctly in the console, the desktop app and the public static site under
// whatever palette each supplies — nothing here hardcodes a background or an ink.
import { useMemo } from "react";
import type { PlotOptions } from "@observablehq/plot";
import type {
  GgAggColumn,
  GgBucket,
  GgGroupKey,
} from "@test-cabinet/run-record/gg-query";
import {
  ChartWidget,
  MetricTile,
  barChart,
  distributionChart,
  stackedBarChart,
  timeSeriesChart,
  type ChartPalette,
} from "@test-cabinet/ui";
import { chooseVisualizations, type GgViz, type GgVizNote } from "./viz";
import styles from "./GgDiscover.module.scss";

interface GgVizPanelProps {
  buckets: readonly GgBucket[];
  columns: readonly GgAggColumn[];
  /** The stage's group keys, in stage order — what tells a date-histogram key from
   *  an ordinary numeric one, and so what tells a time series from a bar chart. */
  groupBy?: readonly GgGroupKey[];
}

export function GgVizPanel({ buckets, columns, groupBy }: GgVizPanelProps) {
  const vizzes = useMemo(
    () => chooseVisualizations(buckets, columns, groupBy),
    [buckets, columns, groupBy],
  );
  if (vizzes.length === 0) return null;

  return (
    <div className={styles.viz}>
      {vizzes.map((viz, index) =>
        viz.kind === "tiles" ? (
          <div key="tiles" className={styles.tiles}>
            {viz.tiles.map((tile) => (
              <MetricTile
                key={tile.label}
                // The denominator rides the label rather than a tooltip: an average
                // over a sparse field that only admits its denominator on hover is
                // one most readers will read as a measurement of the whole bucket.
                label={
                  tile.denominator
                    ? `${tile.label} (${tile.denominator})`
                    : tile.label
                }
                value={tile.value}
                title={tile.hint}
              />
            ))}
          </div>
        ) : (
          <GgVizCard key={`${viz.kind}:${viz.title}:${index}`} viz={viz} />
        ),
      )}
    </div>
  );
}

/** One chart card. The spec is memoized on the visualization so a re-render that
 *  changed nothing does not re-plot the figure underneath the reader's pointer. */
function GgVizCard({ viz }: { viz: Exclude<GgViz, { kind: "tiles" }> }) {
  const spec = useMemo(() => specFor(viz), [viz]);
  return (
    <ChartWidget
      title={viz.title}
      // The accessible name says how much of the result is in the picture, because
      // a screen reader gets the figure as one opaque image and the caption below
      // it is the only place the omissions are otherwise stated.
      chartTitle={`${viz.title}: ${viz.note.shown} ${
        viz.note.shown === 1 ? "bucket" : "buckets"
      }`}
      hint={noteText(viz.note)}
      spec={spec}
    />
  );
}

/** The Plot spec for one visualization, as a palette-taking builder — the shape
 *  `<Chart>` wants, so the live theme is read at plot time rather than baked in. */
function specFor(
  viz: Exclude<GgViz, { kind: "tiles" }>,
): (palette: ChartPalette) => PlotOptions {
  switch (viz.kind) {
    case "series":
      return (palette) =>
        timeSeriesChart(viz.points, palette, viz.series, {
          y: viz.yLabel,
          yTickFormat: viz.format,
        });
    case "bars":
      return (palette) =>
        barChart(viz.points, palette, {
          y: viz.yLabel,
          yTickFormat: viz.format,
          // Category labels here are model ids and capability names, not initials;
          // tilting them is what keeps two dozen of them off each other.
          xTickRotate: -40,
        });
    case "stacked":
      return (palette) =>
        stackedBarChart(viz.segments, palette, viz.series, {
          y: viz.yLabel,
          yTickFormat: viz.format,
          xTickRotate: -40,
        });
    case "distribution":
      return (palette) =>
        distributionChart(viz.groups, palette, {
          y: viz.yLabel,
          yTickFormat: viz.format,
          formatValue: viz.format,
        });
  }
}

/** What the chart left out, in words. Empty when it drew everything, so a complete
 *  chart carries no apologetic subtitle. */
function noteText(note: GgVizNote): string | undefined {
  const parts: string[] = [];
  if (note.dropped > 0) {
    parts.push(
      `${note.dropped} ${note.dropped === 1 ? "bucket" : "buckets"} had no value and ${
        note.dropped === 1 ? "is" : "are"
      } not drawn (never charted as zero)`,
    );
  }
  if (note.hiddenBuckets > 0) {
    parts.push(`${note.hiddenBuckets} more past the chart's cap`);
  }
  if (note.hiddenSeries > 0) {
    // The palette is never cycled, so an entity past it gets no color rather than
    // one another entity already owns — and is named here instead of vanishing.
    parts.push(`${note.hiddenSeries} further series left uncolored`);
  }
  if (parts.length === 0) return undefined;
  return `${parts.join(" · ")}. The table below has every row.`;
}
