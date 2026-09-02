// presentation/chest-draws-world-beneath — the chest overlay is drawn over the
// world, and the world is still there under it.
//
// WHERE THE REQUIREMENT COMES FROM. `specs/ui.md`, "`chest`": "An overlay over
// the held world, opened as `specs/progression.md` states." "What advances on
// each screen" says what "held" means: on `chest` "Nothing. The world beneath
// holds exactly the tick it was at." Where each thing belongs is
// `specs/ui.md`'s "The lamplighter is drawn at the stage center `(STAGE_CX,
// STAGE_CY)` (`640, 360`)" and `specs/world.md`'s camera formula for every
// other world point.
//
// HOW THE OVERLAY IS OPENED. The game's own route: a chest pickup is posed on
// the lamplighter's centre and one `playing` tick runs, which collects it,
// applies its result, and ends on `chest` (`specs/world.md`,
// `specs/progression.md`). No loadout is held, so `specs/evolutions.md`'s
// result rules fall past evolution and past levelling to the heal, and nothing
// about the world changes.
//
// THE BOUND. `SPRITE_TOL` (2 device pixels) on each drawn centre, the rounding
// a build that lands its destination rectangle on whole device pixels picks up;
// the harness opens at the stage's own `1280 x 720`, where one device pixel is
// one stage unit. A build that drew the overlay over an empty field, or over a
// world recentred somewhere else, misses by hundreds.
//
// THE WORLD, AND WHY. `beneath.ts`'s held world: three moths about a
// lamplighter posed off the world origin, every driver switch off, and nothing
// else in the world at all — so the only pickup the tick can collect is the
// chest this check posed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import {
  advanceTicks,
  captureStill,
  createHarness,
  openChest,
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

it("draws the lamplighter and the enemies under the chest overlay", async () => {
  const ids = poseHeldWorld(h);
  const opened = await openChest(h);
  assertEqual(opened.screen, "chest", "the screen the collected chest opened");
  assertNotNull(opened.run.chestResult, "the result the chest overlay shows");

  // The overlay is open; this frame is the one the point is about, and it ticks
  // nothing, so what it draws is what the overlay stands over.
  const blits = await h.frameBlits();
  captureStill(h, "beneath");
  const snapshot = h.snapshot();
  assertEqual(snapshot.screen, "chest", "the screen the read frame drew");

  assertWorldDrawn(h, blits, snapshot, ids, "under the chest overlay");

  // And it is still there a second later, so the world is drawn on every
  // overlay frame rather than left over from the tick that opened it.
  const later = await advanceTicks(h, 30);
  const again = await h.frameBlits();
  assertEqual(later.screen, "chest", "the screen thirty frames on");
  assertWorldDrawn(
    h,
    again,
    h.snapshot(),
    ids,
    "thirty frames into the chest overlay",
  );
});
