import { useEffect, useRef } from "react";
import * as Plot from "@observablehq/plot";
import type { PlotOptions } from "@observablehq/plot";
import { readChartPalette, type ChartPalette } from "./plot/theme";
import styles from "./Chart.module.scss";

interface ChartProps {
  /**
   * Builds the Plot spec for the chart. It receives the live neon palette
   * (read from the theme on the client) so marks can be themed. Use the
   * helpers in `plot/charts.ts` (e.g. `barChart`) to build the returned
   * options.
   */
  spec: (palette: ChartPalette) => PlotOptions;
  /** Accessible title describing what the chart shows. */
  title: string;
  /** Extra class on the figure wrapper, for layout-specific sizing. */
  className?: string;
}

// The single place the site renders an Observable Plot figure. It reads the
// live neon palette on the client, asks the caller's `spec` for themed Plot
// options, and mounts the resulting node into a ref'd container, cleaning up on
// re-render. Charts never imply a ranking — they show distributions and
// per-run magnitudes (see docs/site.md).
//
// Usage:
//   import { Chart } from "../../components/Chart";
//   import { barChart } from "../../components/plot/charts";
//   <Chart title="Cost by harness"
//          spec={(p) => barChart(data, p, { y: "USD" })} />
export function Chart({ spec, title, className }: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Render at the container's width so the figure fills the column (charts
    // with many categories need the room). Re-render on width changes; ignore
    // height-only changes to avoid a resize feedback loop.
    let lastWidth = -1;
    const render = () => {
      const width = container.clientWidth;
      if (width === lastWidth) return;
      lastWidth = width;
      const options = spec(readChartPalette());
      const figure = Plot.plot(width > 0 ? { ...options, width } : options);
      container.replaceChildren(figure);
    };
    render();
    const observer = new ResizeObserver(render);
    observer.observe(container);
    return () => {
      observer.disconnect();
      container.replaceChildren();
    };
  }, [spec]);

  const cls = className ? `${styles.chart} ${className}` : styles.chart;
  return <div ref={containerRef} className={cls} role="img" aria-label={title} />;
}
