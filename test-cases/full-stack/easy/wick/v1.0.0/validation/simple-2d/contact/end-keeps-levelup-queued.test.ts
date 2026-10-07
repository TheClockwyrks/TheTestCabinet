// contact/end-keeps-levelup-queued — a tick that ends the run opens no level-up
// overlay: the queued level-up stays queued on the fallen screen.
//
// THE RULE, FROM THE SPEC. specs/world.md, Fallen and dawn: "A tick that ends
// the run opens no overlay: ... a level-up it queued stays queued." Phase 12 of
// One tick: "A tick that ends the run opens no overlay. Otherwise ... a tick
// that ends with a level-up queued and no chest collected opens the level-up
// overlay". specs/progression.md, The level-up overlay: "A tick that ends the
// run ends it and opens no overlay, chest or level-up."
//
// THE POSE. An isolated night: pendingLevelUps posed to 1 through
// setPendingLevelUps, which "A playing tick that ends with it above 0 opens
// the overlay exactly as a gain does" (specs/instrumentation.md), and hp posed
// to 0 through setHp, which "ends the run fallen at the end of the next playing
// tick". Nothing else is on the field and every switch is off, so the next tick
// both meets the fallen condition and would, without the ending, open the
// overlay. The tick's screen decides which happened, and pendingLevelUps
// whether the queue survived.
//
// THE TOLERANCE. None: the screen and the count are discrete.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";

/** The level-ups queued before the ending tick. */
const QUEUED = 1;

/** The hp posed: the fallen condition's boundary, met without a hit. */
const POSED_HP = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ends the run fallen with the level-up still queued and no overlay opened", async () => {
  isolate(h);
  h.debug.setPendingLevelUps(QUEUED);
  h.debug.setHp(POSED_HP);

  const after = await h.tick(1);
  captureStill(h, "queued");

  assertEqual(after.screen, "fallen", "screen after the ending tick");
  assertEqual(
    after.run.pendingLevelUps,
    QUEUED,
    "pendingLevelUps left queued by the ending tick",
  );
});
