// navigation/space-confirms — Space confirms a menu entry, as Enter does.
//
// specs/modes/*.md bind `confirm` to both `Enter` and `Space`. The selection is
// moved to `HOW TO PLAY` with two real down presses and confirmed with a real
// Space: the screen opened is `howto`.

import { afterEach, beforeEach, expect, it } from "vitest";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the selected entry on Space", async () => {
  await h.debug.reset();
  await h.tap("ArrowDown"); // SOLO -> VERSUS
  await h.tap("ArrowDown"); // VERSUS -> HOW TO PLAY
  await h.tap("Space");
  await captureStill(h, "howto");

  expect((await h.snapshot()).screen).toBe("howto");
});
