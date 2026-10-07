// presentation/levelup-draws-world-beneath — the level-up overlay is drawn over
// the world, and the world is still there under it.
//
// WHERE THE REQUIREMENT COMES FROM. `specs/ui.md`, "`levelup`": "An overlay
// over the world, which stays drawn beneath it exactly as the tick that opened
// the overlay left it." "What advances on each screen" says what "held" means:
// on `levelup` "Nothing. The world beneath holds exactly the tick it was at."
// Where each thing belongs is `specs/ui.md`'s "The lamplighter is drawn at the
// stage center `(STAGE_CX, STAGE_CY)` (`640, 360`)" and `specs/world.md`'s
// camera formula for every other world point.
//
// HOW THE OVERLAY IS OPENED. `specs/progression.md`'s own route: a level-up is
// posed pending with `setPendingLevelUps` and one `playing` tick runs, which
// opens the overlay at its end. No menu is touched and no experience is
// collected, so a build with a broken title or a broken gem fails those points
// and not this one.
//
// THE BOUND. `SPRITE_TOL` (2 device pixels) on each drawn centre, the rounding
// a build that lands its destination rectangle on whole device pixels picks up;
// the harness opens at the stage's own `1280 x 720`, where one device pixel is
// one stage unit. A build that drew the overlay over an empty field, or over a
// world recentred somewhere else, misses by hundreds.
//
// THE WORLD, AND WHY. `beneath.ts`'s held world: three moths about a
// lamplighter posed off the world origin, every driver switch off, and nothing
// else in the world at all.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  advanceTicks,
  captureStill,
  createHarness,
  openLevelUp,
  type Harness,
} from "../harness";
import { assertWorldDrawn, poseHeldWorld } from "./beneath";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws the lamplighter and the enemies under the level-up overlay", async () => {
  const ids = poseHeldWorld(h);
  const opened = await openLevelUp(h);
  assertEqual(
    opened.screen,
    "levelup",
    "the screen the pending level-up opened",
  );
  assertGreaterThan(
    opened.run.offers.length,
    0,
    "the offers the overlay opened with",
  );

  // The overlay is open; this frame is the one the point is about, and it ticks
  // nothing, so what it draws is what the overlay stands over.
  const blits = await h.frameBlits();
  captureStill(h, "beneath");
  const snapshot = h.snapshot();
  assertEqual(snapshot.screen, "levelup", "the screen the read frame drew");

  assertWorldDrawn(h, blits, snapshot, ids, "under the level-up overlay");

  // And it is still there a second later, so the world is drawn on every
  // overlay frame rather than left over from the tick that opened it.
  const later = await advanceTicks(h, 30);
  const again = await h.frameBlits();
  assertEqual(later.screen, "levelup", "the screen thirty frames on");
  assertWorldDrawn(
    h,
    again,
    h.snapshot(),
    ids,
    "thirty frames into the level-up overlay",
  );
});
