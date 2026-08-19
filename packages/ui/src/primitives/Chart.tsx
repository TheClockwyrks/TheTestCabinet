import { useEffect, useRef } from "react";
import * as Plot from "@observablehq/plot";
import type { PlotOptions } from "@observablehq/plot";
import { readChartPalette, type ChartPalette } from "./plot/theme";
import styles from "./Chart.module.scss";

interface ChartProps {
  /**
   * Builds the Plot spec for the chart. It receives the live palette (read from
   * the theme on the client) so marks can be themed. Use the helpers in
   * `plot/charts.ts` (e.g. `barChart`) to build the returned options.
   */
  spec: (palette: ChartPalette) => PlotOptions;
  /** Accessible title describing what the chart shows. */
  title: string;
  /** Extra class on the figure wrapper, for layout-specific sizing. */
  className?: string;
}

// The single place an Observable Plot figure is rendered. It reads the live
// theme palette on the client, asks the caller's `spec` for themed Plot
// options, and mounts the resulting node into a ref'd container, cleaning up on
// re-render. Charts never imply a ranking — they show distributions and per-run
// magnitudes.
//
// Usage:
//   import { Chart, barChart } from "@test-cabinet/ui";
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

    // Touch has no hover to leave. Plot raises a bar's tooltip on tap (the tap
    // arrives as a pointermove) but only takes it down again on a *mouse*
    // pointerleave, so on a phone the tip sticks to the bar with no gesture to
    // clear it — tapping elsewhere in the chart only moves it to another bar,
    // since the charts point by column with a wide radius. Restore the
    // dismissal a touch user expects — tap anywhere off the chart — by handing
    // Plot the mouse-shaped leave event it is waiting for. Listening at the
    // document (capturing) is what makes taps landing on unrelated elements, or
    // on a sibling chart, count as "away".
    const dismissTipOnTapAway = (event: PointerEvent) => {
      // A mouse dismisses by leaving the chart, and its click-to-stick tip by
      // clicking again; don't cut either short.
      if (event.pointerType === "mouse") return;
      if (container.contains(event.target as Node)) return;
      for (const svg of container.querySelectorAll("svg")) {
        svg.dispatchEvent(
          new PointerEvent("pointerleave", { pointerType: "mouse" }),
        );
      }
    };
    document.addEventListener("pointerdown", dismissTipOnTapAway, true);

    return () => {
      document.removeEventListener("pointerdown", dismissTipOnTapAway, true);
      observer.disconnect();
      container.replaceChildren();
    };
  }, [spec]);

  const cls = className ? `${styles.chart} ${className}` : styles.chart;
  return (
    <div ref={containerRef} className={cls} role="img" aria-label={title} />
  );
}
