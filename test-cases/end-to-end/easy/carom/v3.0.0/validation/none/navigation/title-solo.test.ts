// navigation/title-solo — confirming SOLO starts a Solo match.
//
// specs/ui.md: on the title, `confirm` on `SOLO` starts a Solo match, which
// sets `mode`, `screen = countdown`, both scores 0 and `winner` null. The
// confirm is a real Enter key at the title as the game opens, with `menuIndex`
// at 0.

import { afterEach, beforeEach, expect, it } from "vitest";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts a Solo match on its countdown", async () => {
  await h.debug.reset();
  await h.tap("Enter");
  await captureStill(h, "countdown");

  const opened = await h.snapshot();
  expect(opened.screen).toBe("countdown");
  expect(opened.mode).toBe("solo");
  expect(opened.score).toEqual({ p1: 0, p2: 0 });
  expect(opened.winner).toBeNull();
});
