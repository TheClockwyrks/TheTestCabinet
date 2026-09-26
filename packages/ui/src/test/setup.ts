import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Whether this file's tests run against a DOM at all. Almost all of them do — the
// suite's default environment is jsdom — but a file may ask for `node` instead
// (the replay parity test does, because it draws real pixels through a native
// canvas, and jsdom has no canvas backend to draw into). Setup files run for every
// test file whatever environment it chose, so each jsdom patch below is guarded:
// without the guard, a node-environment file dies here on `Element is not defined`
// before it has run a line of its own.
const DOM = typeof document !== "undefined";

// jsdom doesn't implement Element.scrollTo; components that auto-scroll (e.g. the
// run monitor's live feed) call it on every update. Stub it so those effects run.
if (DOM && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}

// jsdom implements no media queries at all, so `window.matchMedia` is simply
// absent — and the app's chrome calls it on mount (the backdrop honours
// `prefers-reduced-motion`). Report "this query does not match" for everything,
// which is the truthful answer for a headless DOM with no viewport and no user
// preferences, and give back the EventTarget-shaped handle callers subscribe to.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => {
    const list = {
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    };
    return list as unknown as MediaQueryList;
  };
}

// jsdom implements no ResizeObserver, and components that size themselves to their
// container (the chart primitive, the Lattice player's fit-to-window zoom) construct
// one in an effect — which would throw during render rather than degrade. Stub it as
// an observer that never fires: jsdom reports every box as zero anyway, so there is no
// measurement to deliver, and each consumer already renders sensibly without one.
if (!("ResizeObserver" in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

// jsdom has no canvas backend, so HTMLCanvasElement.getContext throws a "Not
// implemented" error — and jsdom logs that to its virtual console (→ test stderr)
// even when the caller catches it (as `supportsWebGL` does). None of these tests
// assert on drawn pixels: the 2D/WebGL render + GIF-encode paths are exercised in
// the browser, and every consumer already guards a missing context (`if (!ctx)
// return`, the WebGL probe's `?? null`, the encoders' explicit throw). So report
// "no context available" by returning null instead of throwing — the same signal a
// canvas-less environment should give, minus the noise. Preserves behavior:
// getContext already effectively yielded "unavailable" here; this just does it
// quietly.
if (DOM) HTMLCanvasElement.prototype.getContext = () => null;

// Three gaps jsdom leaves that <Chart> and Observable Plot fall into. Each stub
// gives back the answer a layout-less DOM should give, so the charts' behavior
// (re-plotting, pointing, tooltip dismissal) can be asserted under test.

// The chart re-plots when its container's width changes; jsdom measures every
// element as zero-sized, so there is nothing for a real observer to report. The
// no-op is what lets every chart-bearing component (the gg context-fill graph
// among them) mount under test; no test asserts on drawn plot geometry.
if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Plot measures a tooltip's text with getBBox to size and orient its box. jsdom
// does no layout, so report an empty box — the tip still renders, it just lands
// at the origin, which is all a behavioral assertion needs.
if (DOM && !SVGGraphicsElement.prototype.getBBox) {
  SVGGraphicsElement.prototype.getBBox = () => new DOMRect(0, 0, 0, 0);
}

// Plot's pointer interaction — and the chart's touch tooltip dismissal, which
// hands Plot a synthetic mouse `pointerleave` — branch on `pointerType`, the
// only field these paths read off the event.
if (DOM && !("PointerEvent" in globalThis)) {
  globalThis.PointerEvent = class extends MouseEvent {
    readonly pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? "";
    }
  } as unknown as typeof PointerEvent;
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
    React.useImperativeHandle(ref, () => ({
      scrollToIndex: () => {},
      scrollTo: () => {},
    }));
    // Mirror react-virtuoso's prop handling faithfully: a `computeItemKey` key
    // that is *present* (even with an `undefined` value) overrides the library's
    // `index => index` default and is then called per row — so passing
    // `computeItemKey={undefined}` throws "is not a function" in production. Key
    // off presence, not truthiness, so that footgun reproduces under test rather
    // than being silently papered over.
    const computeItemKey =
      "computeItemKey" in props
        ? (props.computeItemKey as (index: number) => React.Key)
        : (i: number) => i;
    const rows: React.ReactNode[] = [];
    for (let i = 0; i < totalCount; i += 1) {
      rows.push(
        React.createElement(
          "div",
          { key: computeItemKey(i), "data-index": i },
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
