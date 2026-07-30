// The chart's figure is DOM built outside React, so the primitive — not the
// reconciler — decides how a re-plot replaces the old figure. That decision is
// visible to the reader: a chart that empties its container before drawing the
// new figure collapses to zero height, and on a live page (the gg monitor
// re-derives every graph on each telemetry tick) the enclosing scroller loses the
// reader's position. These cover the swap discipline that prevents it.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Chart } from "./Chart";

// Two distinct spec identities. A re-plot is triggered by the `spec` prop
// changing identity, which is what every live caller does — its `useMemo` is
// keyed on the data.
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
});
