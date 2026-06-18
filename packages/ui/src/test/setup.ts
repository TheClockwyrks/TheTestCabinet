import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// jsdom doesn't implement Element.scrollTo; components that auto-scroll (e.g. the
// run monitor's live feed) call it on every update. Stub it so those effects run.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}

// react-virtuoso virtualizes off real element measurements, which jsdom reports
// as zero — so it would render no rows under test. Replace it with a plain list
// that renders every item, so feed tests can assert on the rendered content
// while production still gets true virtualization. The imperative handle the
// feeds hold (for follow-to-bottom snapping) is stubbed.
vi.mock("react-virtuoso", async () => {
  const React = await import("react");
  const Virtuoso = React.forwardRef(function MockVirtuoso(
    props: Record<string, unknown>,
    ref: React.Ref<unknown>,
  ) {
    const totalCount = (props.totalCount as number) ?? 0;
    const itemContent = props.itemContent as
      | ((index: number) => React.ReactNode)
      | undefined;
    const computeItemKey = props.computeItemKey as
      | ((index: number) => React.Key)
      | undefined;
    React.useImperativeHandle(ref, () => ({
      scrollToIndex: () => {},
      scrollTo: () => {},
    }));
    const rows: React.ReactNode[] = [];
    for (let i = 0; i < totalCount; i += 1) {
      rows.push(
        React.createElement(
          "div",
          { key: computeItemKey ? computeItemKey(i) : i, "data-index": i },
          itemContent ? itemContent(i) : null,
        ),
      );
    }
    return React.createElement(
      "div",
      { className: props.className as string, style: props.style as object },
      rows,
    );
  });
  return { Virtuoso };
});

// Unmount React trees between tests so effects (e.g. run subscriptions) tear
// down and don't leak across cases.
afterEach(() => {
  cleanup();
});
