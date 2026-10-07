// Wick — progression/pool-new-passives-with-free-slot: every passive not held
// is a candidate while a passive slot is free.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/progression.md`, "The
// candidate pool": "when a passive slot is free, every passive not held, each
// as a new item". "Slots" gives `PASSIVE_SLOTS` (`6`), and `specs/passives.md`
// lists the ten in `PASSIVE_IDS`; "A run starts with every passive slot empty".
//
// THE POSE. An isolated `playing` run holding no passive at all, so all six
// passive slots are free and the rule admits every one of the ten. Every
// driver switch is off and the world is empty. The overlay is opened by the
// real path, one queued level-up and one `playing` tick.
//
// THE TOLERANCE. Exact: membership of ten ids in a list of ids.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertLength } from "../assert";
import { PASSIVE_IDS } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds all ten passives in the pool with no passive held", async () => {
  isolate(h);

  const overlay = await openLevelUp(h, 1);
  await h.frameDraw();
  captureStill(h, "new");

  assertEqual(overlay.screen, "levelup", "screen after the opening tick");
  assertLength(overlay.run.passives, 0, "passives held");
  for (const id of PASSIVE_IDS) {
    assertContains(
      overlay.run.pool,
      id,
      `run.pool holding the unheld passive ${id} (specs/progression.md, The candidate pool)`,
    );
  }
});
