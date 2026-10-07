// Wick — halo/aura-centered-on-player: the aura's center is the lamplighter's
// center on every tick, while the lamplighter moves.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Halo"): "one zone of kind `aura`, a circle of
//     `radius` centered on the player's center every tick".
//   - `specs/state.md` (`ZoneState`): "A lantern and an aura are placed
//     relative to the lamplighter every tick, so their positions follow the
//     lamplighter", and `x`, `y` are "the center of the circle".
//   - `specs/world.md` ("One tick"): phase 2, "The lamplighter moves", comes
//     before phase 5, where "the aura's center ... [is] placed about the
//     lamplighter's position of this tick", so the snapshot after a tick reads
//     the aura at the position the lamplighter reached on that tick.
//   - `specs/world.md` ("Movement"): with `right` held the lamplighter moves
//     `moveSpeed × TICK_DT` along +x each tick, `MOVE_SPEED` (`180`) with no
//     Bellows held, 3 units a tick; with `down` held, the same along +y.
//
// WHAT IS READ. Over 30 ticks with `right` held and then 30 with `down` held,
// each tick's snapshot: the one Halo aura's `x` and `y` against the
// lamplighter's `x` and `y` of the same snapshot. The pose is only posed if the
// lamplighter moved, so the lamplighter's position is read to have changed
// across each segment; how far it moved is another point's.
//
// WHY THE NIGHT IS POSED AS IT IS. Halo alone at level 1, nothing on the field,
// every switch off: the placement runs on every `playing` tick whatever the
// switches hold (`specs/instrumentation.md`), nothing pulses, and nothing else
// can move the lamplighter or add a zone. The keys are the real movement
// actions, so the aura follows a lamplighter that walks rather than one that
// was posed.
//
// TOLERANCE. `MOTION_TOLERANCE` (1e-6) on each coordinate: the aura is placed
// at a position integrated tick by tick, and a build may hold the aura's
// center as a copy of that position or derive it, either way the same double.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotEqual, assertWithin } from "../assert";
import { MOTION_TOLERANCE } from "../constants";
import {
  captureReplay,
  createHarness,
  keysOf,
  type Harness,
  type WickSnapshot,
} from "../harness";
import { poseHalo, theAura } from "./aura";

/** The level this point holds Halo at. */
const LEVEL = 1;

/** How long each movement key is held, in ticks. */
const SEGMENT_TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

/** Hold `code` for `SEGMENT_TICKS` ticks and hand back the snapshot after each. */
async function walk(code: string): Promise<WickSnapshot[]> {
  h.holdKey(code);
  try {
    return await h.trace(SEGMENT_TICKS);
  } finally {
    h.releaseKey(code);
  }
}

/** The aura's center reads the lamplighter's center on every snapshot of `trace`. */
function assertCentered(trace: readonly WickSnapshot[], segment: string): void {
  trace.forEach((snapshot, index) => {
    const which = `${segment}, tick ${index + 1}`;
    const aura = theAura(snapshot, which);
    const { player } = snapshot.run;
    assertWithin(aura.x, player.x, MOTION_TOLERANCE, `${which}: aura x`);
    assertWithin(aura.y, player.y, MOTION_TOLERANCE, `${which}: aura y`);
  });
}

it("reads the aura at the lamplighter's center on every tick while it walks right, then down", async () => {
  const { posed } = poseHalo(h, LEVEL, null);
  const start = posed.run.player;

  const { right, down } = await captureReplay(h, "centered", async () => ({
    right: await walk(keysOf("right")[0]),
    down: await walk(keysOf("down")[0]),
  }));

  // The pose: the lamplighter walked on each segment.
  assertNotEqual(
    right[right.length - 1].run.player.x,
    start.x,
    "the lamplighter's x after the right segment, against its start",
  );
  assertNotEqual(
    down[down.length - 1].run.player.y,
    right[right.length - 1].run.player.y,
    "the lamplighter's y after the down segment, against the right segment's end",
  );

  assertCentered(right, "walking right");
  assertCentered(down, "walking down");
});
