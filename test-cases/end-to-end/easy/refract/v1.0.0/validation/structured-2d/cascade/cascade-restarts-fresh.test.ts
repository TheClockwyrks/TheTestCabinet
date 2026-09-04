// Refract — cascade/cascade-restarts-fresh: starting Cascade again begins a
// fresh sequence.
//
// specs/modes/cascade.md "The sequence": backing out of playing ends the
// sequence, and starting Cascade again begins a fresh one from tier 1 — entry
// itself sets solvedCount to 0. That `back` reaches the title at all is
// cascade/cascade-back-to-title's point; here the subject is what the NEXT run
// starts from.
//
// Progress is built first (TIER_ADVANCE real solves, so solvedCount is 5 and
// the tier has climbed) so a fresh sequence is distinguishable from a continued
// one, then `back` is pressed and CASCADE is chosen again through the real
// title menu — the return already highlights the entry that led away, so a
// plain `confirm` takes it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  solveGenerated,
  tapAction,
  type Harness,
} from "../harness";
import { TIER_ADVANCE } from "../notation";

const SEED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("re-entering after a back starts from solvedCount 0 and tier 1", async () => {
  await solveGenerated(h, TIER_ADVANCE, SEED);
  await tapAction(h, "confirm");
  assertEqual(
    h.snapshot().solvedCount,
    TIER_ADVANCE,
    "progress stands before back",
  );

  await tapAction(h, "back");
  await h.advance(1);
  assertEqual(
    h.snapshot().screen,
    "title",
    "precondition: back reaches the title (see cascade-back-to-title)",
  );

  // Start Cascade again: the return already highlights CASCADE, so confirm
  // takes it.
  await tapAction(h, "confirm");
  await h.advance(1);
  // The fresh sequence after backing out.
  captureStill(h, "fresh");

  const fresh = h.snapshot();
  assertEqual(fresh.screen, "playing", "Cascade starts again on playing");
  assertEqual(fresh.mode, "cascade", "the restarted mode is cascade");
  assertEqual(
    fresh.solvedCount,
    0,
    "the fresh sequence starts at solvedCount 0",
  );
  assertEqual(fresh.tier, 1, "the fresh sequence starts at tier 1");
});
