import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Chart } from "./Chart";
import { barChart } from "./plot/charts";
import type { ChartPalette } from "./plot/theme";

const bars = [
  { label: "A", value: 3, title: "A\n3" },
  { label: "B", value: 5, title: "B\n5" },
];

const spec = (palette: ChartPalette) => barChart(bars, palette);

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
});
