import type { ReactNode } from "react";
import type { PlotOptions } from "@observablehq/plot";
import { Chart } from "./Chart";
import { Panel } from "./Panel";
import type { ChartPalette } from "./plot/theme";
import styles from "./ChartWidget.module.scss";

interface ChartWidgetProps {
  /** Heading naming the chart, e.g. "By configuration". */
  title: string;
  /**
   * The chart's accessible name, when it should say more than the heading
   * ("Average tokens by model — per run"). Defaults to {@link title}.
   */
  chartTitle?: string;
  /** A one-line explanation of what the chart shows, under the title. */
  hint?: string;
  /** Controls rendered on the header's trailing edge (e.g. a metric picker). */
  actions?: ReactNode;
  /**
   * Builds the Plot spec, receiving the live palette. Omit it when there is
   * nothing to plot — {@link empty} is shown in the chart's place, so a widget
   * with no data still reads as the same card rather than vanishing.
   */
  spec?: (palette: ChartPalette) => PlotOptions;
  /** Shown in place of the chart when no {@link spec} is given. */
  empty?: string;
}

// The standard chart card: a titled, full-width panel wrapping one Plot figure.
// It is what makes a page of charts read as a set of widgets rather than figures
// floating on the backdrop, and it is the only place the title/hint/controls
// arrangement above a chart is defined.
export function ChartWidget({
  title,
  chartTitle,
  hint,
  actions,
  spec,
  empty = "Nothing to chart yet.",
}: ChartWidgetProps) {
  return (
    <Panel>
      <header className={styles.header}>
        <div>
          <h3 className={styles.title}>{title}</h3>
          {hint && <p className={styles.hint}>{hint}</p>}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </header>
      {spec ? (
        <Chart title={chartTitle ?? title} spec={spec} />
      ) : (
        <p className={styles.empty}>{empty}</p>
      )}
    </Panel>
  );
}
