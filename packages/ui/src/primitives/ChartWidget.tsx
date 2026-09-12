import type { ReactNode } from "react";
import type { PlotOptions } from "@observablehq/plot";
import { Chart } from "./Chart";
import { Panel } from "./Panel";
import type { ChartPalette } from "./plot/theme";
import styles from "./ChartWidget.module.scss";

interface SectionWidgetProps {
  /** Heading naming the section, e.g. "Score & pass rate". */
  title: string;
  /** A one-line explanation of what the section shows, under the title. */
  hint?: string;
  /** Controls rendered on the header's trailing edge (e.g. a metric picker). */
  actions?: ReactNode;
  /** The section's body — a chart, a table, a stack of per-arm rows. */
  children: ReactNode;
}

// The widget shell every titled block on a figure page wears: a full-width panel
// with the shared title/hint/controls header above whatever the section shows.
//
// It exists so a page's hand-rolled section is built the same way as its charts
// rather than as a special case. A column mixing `ChartWidget`s with a bare
// `<section>` reads wrong twice over: the bare one takes its rhythm from its own
// margins while the widgets take theirs from the column, and its title sits out
// on the backdrop (needing the readability halo) while theirs sit inside a panel.
// Wrapping it here makes it a peer — same surface, same header, same rhythm.
export function SectionWidget({
  title,
  hint,
  actions,
  children,
}: SectionWidgetProps) {
  return (
    <Panel>
      <header className={styles.header}>
        <div>
          <h3 className={styles.title}>{title}</h3>
          {hint && <p className={styles.hint}>{hint}</p>}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </header>
      {children}
    </Panel>
  );
}

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
// arrangement above a chart is defined — {@link SectionWidget} is that
// arrangement, shared with the non-chart sections that sit in the same column.
export function ChartWidget({
  title,
  chartTitle,
  hint,
  actions,
  spec,
  empty = "Nothing to chart yet.",
}: ChartWidgetProps) {
  return (
    <SectionWidget title={title} hint={hint} actions={actions}>
      {spec ? (
        <Chart title={chartTitle ?? title} spec={spec} />
      ) : (
        <p className={styles.empty}>{empty}</p>
      )}
    </SectionWidget>
  );
}
