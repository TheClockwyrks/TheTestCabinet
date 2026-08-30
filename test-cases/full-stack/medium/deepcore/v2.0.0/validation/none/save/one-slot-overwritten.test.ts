// save/one-slot-overwritten — the second save replaces the first.
//
// specs/gameplay.md: "There is one save slot, and saving overwrites it". So an
// expedition saved twice restores to the LATER of the two, and the earlier one is
// gone rather than sitting beside it.
//
// TWO STATES THAT CANNOT BE CONFUSED. Each save is taken at its own Credits
// balance and its own drill tier, so the restored expedition names which of the
// two it came from on both counts, and a build keeping a second slot restores the
// first.
//
// ISOLATION. One expedition on an empty mine, the slot cleared first, the miner
// standing at the camp where saving is allowed, and nothing carried, held or
// installed. Both saves are written through the control that stands for the Save
// Pad, and the restore through the title's `CONTINUE`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { bankSave, continueFromTitle, openAtCamp } from "./expedition";

/** The first save's state, which the second must displace. */
const FIRST = { credits: 1234, drill: 2 };
/** The second save's state, which is the one a continue must restore. */
const SECOND = { credits: 4321, drill: 4 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("restores the later of two saves rather than the earlier", async () => {
  await openAtCamp(h);

  await h.debug.setCredits(FIRST.credits);
  await h.debug.setTier("drill", FIRST.drill);
  await bankSave(h);

  await h.debug.setCredits(SECOND.credits);
  await h.debug.setTier("drill", SECOND.drill);
  await bankSave(h);

  await continueFromTitle(h);
  await h.advance(1);

  const restored = await h.snapshot();
  await captureStill(h, "slot");
  assertEqual(
    restored.credits,
    SECOND.credits,
    "specs/gameplay.md: saving overwrites the single slot",
  );
  assertEqual(
    restored.tiers.drill,
    SECOND.drill,
    "specs/gameplay.md: the restored expedition is the second save, not the first",
  );
});
