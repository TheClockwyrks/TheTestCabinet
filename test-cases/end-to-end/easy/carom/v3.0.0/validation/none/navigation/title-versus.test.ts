// navigation/title-versus — confirming VERSUS starts a Versus match.
//
// specs/ui.md: on the title, `confirm` on `VERSUS` starts a Versus match, which
// sets `mode`, `screen = countdown`, both scores 0 and `winner` null. The
// selection is moved to `VERSUS` with one real down press and confirmed with a
// real Enter.

import { afterEach, beforeEach, expect, it } from "vitest";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts a Versus match on its countdown", async () => {
  await h.debug.reset();
  await h.tap("ArrowDown");
  await h.tap("Enter");
  await captureStill(h, "countdown");

  const opened = await h.snapshot();
  expect(opened.screen).toBe("countdown");
  expect(opened.mode).toBe("versus");
  expect(opened.score).toEqual({ p1: 0, p2: 0 });
  expect(opened.winner).toBeNull();
});
