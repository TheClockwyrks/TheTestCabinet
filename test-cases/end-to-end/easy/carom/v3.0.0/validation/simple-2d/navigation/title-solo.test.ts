// Carom — navigation/title-solo: confirming SOLO starts a Solo match.
//
// One transition of the menu state machine specs/ui.md fixes. It starts from
// the title, which `reset()` restores with `menuIndex` at 0. Every key is a
// real key event dispatched at the target the engine listens on, so the action
// is raised by the binding the case declares, and the result is read back off
// the game's own state. The still is the frame the press left.

import { afterEach, beforeEach, expect, it } from "vitest";
import { TITLE_ITEMS } from "../../src/constants";
import { captureStill, createHarness, type Harness } from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("starts a Solo match from the first title item", async () => {
  h.debug.reset();
  expect(TITLE_ITEMS[0]).toBe("SOLO");
  await h.tap("Enter");
  captureStill(h, "countdown");

  const opened = h.snapshot();
  expect(opened.mode).toBe("solo");
  expect(opened.screen).toBe("countdown");
  expect(opened.score).toEqual({ p1: 0, p2: 0 });
});
