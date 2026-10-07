// The chart's figure is DOM built outside React, so the primitive — not the
// reconciler — decides how a re-plot replaces the old figure and when the figure
// is finally dropped. It also owns the tooltip dismissal Plot leaves to its host
// on touch. Both are invisible in the markup and only observable as behaviour,
// which is what these cover.

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Chart } from "./Chart";
import { barChart, horizontalBarChart } from "./plot/charts";
import type { ChartPalette } from "./plot/theme";

const bars = [
  { label: "A", value: 3, title: "A\n3" },
  { label: "B", value: 5, title: "B\n5" },
];

const spec = (palette: ChartPalette) => barChart(bars, palette);

// A re-plot is triggered by the `spec` prop changing identity, which is what
// every live caller does — its `useMemo` is keyed on the data. These give the
// swap tests two distinct identities without two distinct figures.
const emptySpec = () => ({ marks: [] });

// Records every `replaceChildren` call the container receives, so a test can ask
// whether it was ever called with no nodes — the call that leaves it empty.
function watchSwaps(container: Element): { emptied: number } {
  const seen = { emptied: 0 };
  const real = container.replaceChildren.bind(container);
  container.replaceChildren = (...nodes: (Node | string)[]) => {
    if (nodes.length === 0) seen.emptied += 1;
    real(...nodes);
  };
  return seen;
}

// Plot renders its tip layer up front (an empty `aria-label="tip"` group) and
// fills it with the tooltip's box and text only while a bar is pointed at — so
// "is a tooltip showing?" is a question about that group's contents.
function tipShowing(container: HTMLElement): boolean {
  const tip = container.querySelector('[aria-label="tip"]');
  return tip != null && tip.childElementCount > 0;
}

// Simulates a touch tap landing on the chart, which the browser delivers to Plot
// as a pointermove (raising the tip) followed by a pointerdown.
function tapChart(container: HTMLElement) {
  const svg = container.querySelector("svg")!;
  for (const type of ["pointermove", "pointerdown"]) {
    svg.dispatchEvent(
      new PointerEvent(type, {
        pointerType: "touch",
        bubbles: true,
        clientX: 100,
        clientY: 100,
      }),
    );
  }
}

function tapAway(target: Element = document.body) {
  target.dispatchEvent(
    new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true }),
  );
}

describe("Chart", () => {
  it("swaps in the new figure without ever emptying the container", () => {
    const { rerender } = render(<Chart title="Tokens" spec={emptySpec} />);
    const container = screen.getByRole("img", { name: "Tokens" });
    expect(container.childElementCount).toBe(1);

    const swaps = watchSwaps(container);
    const first = container.firstElementChild;
    rerender(<Chart title="Tokens" spec={() => ({ marks: [] })} />);

    // The old figure was replaced, not removed and later re-added: the container
    // held a figure at every point in between, so its height never collapsed.
    expect(swaps.emptied).toBe(0);
    expect(container.childElementCount).toBe(1);
    expect(container.firstElementChild).not.toBe(first);
  });

  it("clears the figure it created on unmount", () => {
    const { unmount } = render(<Chart title="Tokens" spec={emptySpec} />);
    const container = screen.getByRole("img", { name: "Tokens" });
    const swaps = watchSwaps(container);

    // React does not own the figure node, so the primitive has to drop it itself
    // — just not until the component is actually going away, which is why the
    // clearing lives in its own mount-scoped effect rather than in the re-plot
    // effect's cleanup.
    unmount();
    expect(swaps.emptied).toBe(1);
  });

  it("dismisses a tooltip raised by touch when the next tap lands off the chart", () => {
    const { container } = render(<Chart title="Tokens" spec={spec} />);
    tapChart(container);
    // Touch has no hover, so without a dismissal path this tip would be stuck.
    expect(tipShowing(container)).toBe(true);
    tapAway();
    expect(tipShowing(container)).toBe(false);
  });

  it("keeps the tooltip while taps stay on the chart", () => {
    const { container } = render(<Chart title="Tokens" spec={spec} />);
    tapChart(container);
    tapAway(container.querySelector("svg")!);
    expect(tipShowing(container)).toBe(true);
  });

  it("leaves a mouse-driven tooltip alone", () => {
    const { container } = render(<Chart title="Tokens" spec={spec} />);
    const svg = container.querySelector("svg")!;
    svg.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerType: "mouse",
        bubbles: true,
        clientX: 100,
        clientY: 100,
      }),
    );
    expect(tipShowing(container)).toBe(true);
    // A mouse click elsewhere on the page is not the touch dismissal gesture;
    // the mouse dismisses by leaving the chart (and unsticks by clicking again).
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { pointerType: "mouse", bubbles: true }),
    );
    expect(tipShowing(container)).toBe(true);
  });

  it("stops listening for taps once unmounted", () => {
    const { container, unmount } = render(<Chart title="Tokens" spec={spec} />);
    unmount();
    expect(() => tapAway()).not.toThrow();
    expect(container.querySelector("svg")).toBeNull();
  });

  describe("page-level tip (horizontal bar charts)", () => {
    const rows = [
      { label: "a", value: 3, title: "a\nsrc/a.ts:12" },
      { label: "b", value: 5, title: "b\nsrc/b.ts:4" },
    ];
    const rowSpec = (palette: ChartPalette) =>
      horizontalBarChart(rows, palette);

    // The bubble lives on document.body, outside the chart and every card around
    // it, which is what keeps a wide tip from being clipped.
    const pageTip = (): HTMLElement | null =>
      [
        ...document.body.querySelectorAll<HTMLElement>("[aria-hidden=true]"),
      ].find((el) => el.textContent?.includes("src/")) ?? null;

    function hoverChart(container: HTMLElement) {
      container.querySelector("svg")!.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerType: "mouse",
          bubbles: true,
          clientX: 100,
          clientY: 20,
        }),
      );
    }

    it("shows the pointed-at bar's title outside the chart", () => {
      const { container } = render(<Chart title="Ranking" spec={rowSpec} />);
      hoverChart(container);
      const tip = pageTip();
      expect(tip).not.toBeNull();
      expect(tip!.hidden).toBe(false);
      expect(container.contains(tip)).toBe(false);
      // Plot's own in-SVG tip is not drawn alongside it.
      expect(tipShowing(container)).toBe(false);
    });

    // jsdom lays nothing out, so the geometry the bubble reads is stubbed: the
    // highlighted bar's box, the bubble's own size, and the viewport's width.
    afterEach(() => {
      vi.restoreAllMocks();
    });

    function placeOver(bar: Partial<DOMRect>) {
      vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockReturnValue({
        left: 0,
        right: 0,
        top: 200,
        bottom: 213,
        width: 0,
        height: 13,
        ...bar,
      } as DOMRect);
      vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(
        200,
      );
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(
        40,
      );
      vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(1280);
    }

    it("centres the bubble on a bar with length", () => {
      placeOver({ left: 300, right: 400, width: 100 });
      const { container } = render(<Chart title="Ranking" spec={rowSpec} />);
      hoverChart(container);
      // Centred on the bar's middle (350), half the box's width either side.
      expect(pageTip()!.style.left).toBe("250px");
    });

    it("opens rightward from the bar start for a 0% bar", () => {
      placeOver({ left: 300, right: 300, width: 0 });
      const { container } = render(<Chart title="Ranking" spec={rowSpec} />);
      hoverChart(container);
      // The arrow's inset short of the bar start, rather than 100px back over
      // the labels.
      expect(pageTip()!.style.left).toBe("288px");
    });

    it("hides when the pointer leaves the chart", () => {
      const { container } = render(<Chart title="Ranking" spec={rowSpec} />);
      hoverChart(container);
      container
        .querySelector("svg")!
        .dispatchEvent(
          new PointerEvent("pointerleave", { pointerType: "mouse" }),
        );
      expect(pageTip()!.hidden).toBe(true);
    });

    it("is removed from the page on unmount", () => {
      const { container, unmount } = render(
        <Chart title="Ranking" spec={rowSpec} />,
      );
      hoverChart(container);
      unmount();
      expect(pageTip()).toBeNull();
    });
  });
});
