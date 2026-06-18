import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom doesn't implement Element.scrollTo; components that auto-scroll (e.g. the
// run monitor's live feed) call it on every update. Stub it so those effects run.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}

// Unmount React trees between tests so effects (e.g. run subscriptions) tear
// down and don't leak across cases.
afterEach(() => {
  cleanup();
});
