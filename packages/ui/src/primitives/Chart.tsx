import { useEffect, useRef } from "react";
import * as Plot from "@observablehq/plot";
import type { PlotOptions } from "@observablehq/plot";
import { PAGE_TIP_ANCHOR } from "./plot/charts";
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
//   import { Chart, barChart } from "@clockwyrks/ui";
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
    const pageTip = createPageTip(container);
    const render = () => {
      const width = container.clientWidth;
      if (width === lastWidth) return;
      lastWidth = width;
      const options = spec(readChartPalette());
      const figure = Plot.plot(width > 0 ? { ...options, width } : options);
      // Swap the old figure for the new one in a single mutation, never leaving
      // the container empty: emptying it first would collapse its height, and on
      // a live page whose charts all re-plot together (the gg monitor re-derives
      // every graph on each telemetry tick) the enclosing scroller's content
      // would briefly shrink to nothing, clamping the reader's scroll position
      // to the top. The height it comes back to is not restored — the scroll is
      // simply lost — so the container must stay occupied across the swap.
      container.replaceChildren(figure);
      // The old figure's selection went with it.
      pageTip.hide();
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
      pageTip.remove();
    };
  }, [spec]);

  // The figure is DOM we created outside React, so React will not remove it when
  // this component unmounts. Clearing it belongs here, on unmount only, and not in
  // the render effect's cleanup, which also runs between re-plots (see above).
  useEffect(() => {
    const container = containerRef.current;
    return () => container?.replaceChildren();
  }, []);

  const cls = className ? `${styles.chart} ${className}` : styles.chart;
  return (
    <div ref={containerRef} className={cls} role="img" aria-label={title} />
  );
}

/** The room kept between the page-level tip and the viewport's edges, in px. */
const VIEWPORT_MARGIN = 8;
/** The gap between the tip's box and the mark it points at; the arrow spans it. */
const TIP_GAP = 8;
/** The closest the arrow comes to the box's rounded corners, in px. */
const ARROW_INSET = 12;

/**
 * The hover tip a chart opts into by tagging its pointer-highlight mark with
 * `PAGE_TIP_ANCHOR` (see there for why).
 *
 * The bubble is a fixed-position element on `document.body`, so no card's
 * overflow clips it. It listens for the `input` event Plot raises on the figure
 * whenever the pointer selection changes, shows the selected datum's `title`,
 * and places itself above the highlighted mark — below it when there is no room
 * above — centred on it, or opening rightward from it when the mark has no
 * length, then shifted sideways as far as it must to stay inside the viewport,
 * with its arrow moved the other way so it still points at the mark. A chart without
 * the anchor class never shows it, and keeps Plot's own tip.
 */
function createPageTip(container: HTMLElement): {
  hide: () => void;
  remove: () => void;
} {
  const tip = document.createElement("div");
  tip.className = styles.pageTip ?? "";
  tip.setAttribute("aria-hidden", "true");
  tip.hidden = true;
  const text = document.createElement("div");
  const arrow = document.createElement("div");
  arrow.className = styles.pageTipArrow ?? "";
  tip.append(text, arrow);
  document.body.append(tip);

  const anchor = (): Element | null =>
    container.querySelector(
      `.${PAGE_TIP_ANCHOR} rect, .${PAGE_TIP_ANCHOR} path`,
    );

  const hide = () => {
    tip.hidden = true;
  };

  const place = () => {
    const mark = anchor();
    if (!mark) return hide();
    const target = screenBox(mark);
    tip.hidden = false;
    const { offsetWidth: width, offsetHeight: height } = tip;
    const viewport = document.documentElement.clientWidth;
    const pointX = target.left + target.width / 2;
    // A bar with no length (a 0% row) is a point at the bar start, where the
    // labels end: centring the box on it would spread half of it back over the
    // labels and past the chart's edge. Such a box opens rightward from the
    // point instead, over the empty row, with its arrow at its left corner.
    const preferred =
      target.width < 1 ? pointX - ARROW_INSET : pointX - width / 2;
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(preferred, viewport - VIEWPORT_MARGIN - width),
    );
    const above = target.top - TIP_GAP - height >= VIEWPORT_MARGIN;
    const top = above ? target.top - TIP_GAP - height : target.bottom + TIP_GAP;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    tip.dataset.side = above ? "above" : "below";
    arrow.style.left = `${Math.max(
      ARROW_INSET,
      Math.min(pointX - left, width - ARROW_INSET),
    )}px`;
  };

  const onInput = (event: Event) => {
    const value = (event.target as { value?: unknown }).value;
    const title =
      value && typeof value === "object" && "title" in value
        ? (value as { title?: unknown }).title
        : null;
    if (typeof title !== "string" || !anchor()) return hide();
    text.textContent = title;
    place();
  };
  // Fixed positioning is relative to the viewport, so the bubble follows its mark
  // through a scroll of the page or any scroller around the chart.
  const onScroll = () => {
    if (!tip.hidden) place();
  };

  container.addEventListener("input", onInput);
  document.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll);
  return {
    hide,
    remove: () => {
      container.removeEventListener("input", onInput);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      tip.remove();
    },
  };
}

/**
 * Where a mark sits on screen.
 *
 * A bar's box is read from its own geometry — the rect's `x`, `y`, `width` and
 * `height`, mapped through its screen transform — rather than from
 * `getBoundingClientRect`, because a bar with no length (a 0% row) has no box
 * to Firefox: it reports both that and `getBBox` as an empty box at the
 * figure's corner, which put the bubble to the left of the labels. Anything
 * that is not a rect, or a DOM with no layout (jsdom), falls back to the
 * client rect.
 */
function screenBox(mark: Element): {
  left: number;
  top: number;
  bottom: number;
  width: number;
} {
  const rect =
    typeof SVGRectElement !== "undefined" && mark instanceof SVGRectElement
      ? mark
      : null;
  const ctm = rect?.getScreenCTM();
  if (!rect || !ctm) return mark.getBoundingClientRect();
  const x = rect.x.baseVal.value;
  const y = rect.y.baseVal.value;
  const from = new DOMPoint(x, y).matrixTransform(ctm);
  const to = new DOMPoint(
    x + rect.width.baseVal.value,
    y + rect.height.baseVal.value,
  ).matrixTransform(ctm);
  return {
    left: Math.min(from.x, to.x),
    top: Math.min(from.y, to.y),
    bottom: Math.max(from.y, to.y),
    width: Math.abs(to.x - from.x),
  };
}
