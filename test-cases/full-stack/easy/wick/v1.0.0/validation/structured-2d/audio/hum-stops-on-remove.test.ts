// Wick — audio/hum-stops-on-remove: the hum stops when Halo leaves the
// loadout.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, The loops: "`hum` is looping
// on every frame exactly when `screen` is `playing` and a held weapon is
// `halo` or `corona` ... and it stops on the frame either stops being true."
// With Halo removed the weapon conjunct is false, so the threshold is `false`
// on every frame after it.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Halo alone, with
// the hum let up and read as `true` first: what this point decides is the
// STOP, and a hum that never started says nothing about it. Then
// `removeWeapon` on Halo's slot, which "Removes the weapon in `slot`, a held
// slot", leaving the loadout empty, and the frames after it are read.
//
// The screen stays `playing` throughout, so the conjunct that changed is the
// weapon one and nothing else: a build that stops the hum only when the
// screen leaves `playing` fails here, which is the point of removing rather
// than pausing. `weaponFire` stays off so Halo's pulses never run, and the
// world holds no enemy, projectile, zone, gem, or pickup.
//
// THE TOLERANCE. One frame for the reconciliation, which the specification
// itself grants — "Both loops are reconciled from the state on every frame" —
// and no gap after it. The reading is a boolean.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUES } from "../constants";
import {
  captureReplay,
  createHarness,
  holdWeapon,
  type Harness,
} from "../harness";
import { isolatedRun, loopTrace } from "./cues";

/** Frames read after the removal: the reconciling frame and half a second. */
const FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("has hum not looping on the frames after Halo is removed", async () => {
  await isolatedRun(h);
  const slot = holdWeapon(h, "halo", 1);
  await h.advance(1);
  assertEqual(
    h.looping(CUES.hum),
    true,
    "whether the hum was up on playing with Halo held",
  );

  h.debug.removeWeapon(slot);
  assertEqual(
    h.snapshot().run.weapons.length,
    0,
    "the weapons left held after the removal",
  );

  const trace = await captureReplay(h, "stopped", () =>
    loopTrace(h, CUES.hum, FRAMES),
  );

  assertEqual(
    h.snapshot().screen,
    "playing",
    "the screen the run held for the whole span, so the weapon is what changed",
  );
  assertEqual(
    trace.filter((looping) => looping).length,
    0,
    `frames after Halo was removed on which hum was still looping, of ${FRAMES} (specs/ui.md, The loops)`,
  );
});
