// Wick — audio/hum-with-corona: Corona carries the hum exactly as Halo does.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, The loops: "`hum` is looping
// on every frame exactly when `screen` is `playing` and a held weapon is
// `halo` or `corona` ... and it stops on the frame either stops being true."
// `specs/evolutions.md`, Corona, says the same from the evolution's side:
// "Corona keeps the `hum` loop that Halo carried, as `specs/ui.md` states."
// With Corona held on `playing` the threshold is `true`, and from the frame
// it is removed the threshold is `false`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding Corona alone,
// placed with `setWeapon`, which takes an evolved weapon at level `1`
// (`specs/instrumentation.md`). Corona rather than Halo is the whole point:
// the rule names two weapon ids and a build that wired the hum to Halo's id
// alone loses it the moment a run's Halo evolves, which is exactly when a
// player has it. Halo is not held beside it — an evolved weapon's base "is
// held in another slot" is invalid — so the hum read here is Corona's.
//
// The removal is `removeWeapon` on Corona's slot, with the screen left on
// `playing` throughout, so the conjunct that changes is the weapon one alone.
// `weaponFire` stays off so Corona's pulses never run, and the world holds no
// enemy, projectile, zone, gem, or pickup.
//
// THE TOLERANCE. One frame for the reconciliation, which the specification
// itself grants, and no gap after it. The reading is a boolean.

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

/** Frames read on each side: the reconciling frame and half a second. */
const FRAMES = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("has hum looping while Corona is held on playing and not after it is removed", async () => {
  await captureReplay(h, "corona", async () => {
    await isolatedRun(h);
    const slot = holdWeapon(h, "corona", 1);

    const held = await loopTrace(h, CUES.hum, FRAMES);
    assertEqual(
      held.filter((looping) => !looping).length,
      0,
      `frames with Corona held on playing on which hum was not looping, of ${FRAMES} (specs/ui.md, The loops)`,
    );

    h.debug.removeWeapon(slot);
    assertEqual(
      h.snapshot().run.weapons.length,
      0,
      "the weapons left held after Corona was removed",
    );

    const gone = await loopTrace(h, CUES.hum, FRAMES);
    assertEqual(
      h.snapshot().screen,
      "playing",
      "the screen the run held throughout, so the weapon is what changed",
    );
    assertEqual(
      gone.filter((looping) => looping).length,
      0,
      `frames after Corona was removed on which hum was still looping, of ${FRAMES} (specs/ui.md, The loops)`,
    );
  });
});
