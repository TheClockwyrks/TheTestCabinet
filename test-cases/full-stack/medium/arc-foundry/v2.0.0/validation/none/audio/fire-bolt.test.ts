// Arc Foundry — audio/fire-bolt: the bolt cue sounds on the frame a Capacitor, a
// Choke or a Rectifier fires, and on no frame before it.
//
// THE REQUIREMENT, from the cue table of `specs/ui.md`: `CUES.fireBolt` is played
// when "a Capacitor, a Choke, or a Rectifier fires", and each cue is played "on the
// update its event happens, and at most once on that update".
//
// WHAT MARKS THE EVENT. `specs/components.md` puts every shot on a travelling
// projectile — "On firing, the structure launches a projectile from its center" —
// so the frame a projectile appears is the frame the structure fired.
//
// WHAT IS ASSERTED, AND WHAT CANNOT BE. That a sound was emitted, and that it was
// emitted on the frame of the shot rather than before it. The structure is stood up
// alone first and held with nothing in range, where `specs/components.md` says it
// "holds fire", and every sound from that moment on is recorded — so a build that
// plays nothing fails, one that plays a frame early or a frame late fails, and one
// that blips every frame fails on the run-up. What cannot be separated from outside
// an engineless build is a build that plays the WRONG cue on the right event,
// because the name of a sound is not observable; that half is the reviewer's, by
// ear.
//
// ALL THREE TYPES, BECAUSE THE REQUIREMENT NAMES ALL THREE. They are one point
// because they are one cue on one event; each runs on its own emptied yard.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { FIRE_CUE, type ComponentType } from "../constants";
import {
  captureReplay,
  createHarness,
  openYard,
  type Harness,
} from "../harness";
import { SETTLE, beforeFrame, fireOnce, onFrame } from "./cues";

/** The three types `specs/ui.md` binds to the bolt cue, per `FIRE_CUE`. */
const TYPES: ComponentType[] = (
  ["capacitor", "choke", "rectifier"] as ComponentType[]
).filter((type) => FIRE_CUE[type] === "fire-bolt");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds on the frame each of the three fires, and not before", async () => {
  await h.armAudio();
  await openYard(h, { wave: 1 });
  await h.advance(SETTLE);

  for (const type of TYPES) {
    const shot = await captureReplay(h, "bolt", () => fireOnce(h, type, 1));

    assertEqual(
      shot.fired,
      true,
      `a Scrap ${type} with a unit inside its range to fire within four ` +
        "seconds (specs/components.md)",
    );
    assertDeepEqual(
      beforeFrame(shot.cues, shot.frame).map((cue) => cue.frame),
      [],
      `nothing to sound while a ${type} holds fire with nothing in range ` +
        "(specs/ui.md)",
    );
    assertGreaterThan(
      onFrame(shot.cues, shot.frame).length,
      0,
      `a cue to sound on the frame a ${type} fires (specs/ui.md)`,
    );
  }
});
