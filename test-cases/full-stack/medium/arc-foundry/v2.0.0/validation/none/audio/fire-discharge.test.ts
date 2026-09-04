// Arc Foundry — audio/fire-discharge: the discharge cue sounds on the frame an
// Arc-Node or a Discharge Rig fires, and on no frame before it.
//
// THE REQUIREMENT, from the cue table of `specs/ui.md`: `CUES.fireDischarge` is
// played when "an Arc-Node or a Discharge Rig fires", and each cue is played "on the
// update its event happens, and at most once on that update".
//
// WHAT MARKS THE EVENT. `specs/components.md` puts every shot on a travelling
// projectile, so the frame a projectile appears is the frame the structure fired.
//
// WHAT IS ASSERTED, AND WHAT CANNOT BE. That a sound was emitted, and on the frame
// of the shot rather than before it. Each structure is stood up alone first and held
// with nothing in range, where `specs/components.md` says it "holds fire", and every
// sound from that moment on is recorded. What cannot be separated from outside an
// engineless build is a build that plays the WRONG cue on the right event, because
// the name of a sound is not observable; that half is the reviewer's, by ear.
//
// BOTH TYPES, BECAUSE THE REQUIREMENT NAMES BOTH. They are one point because they
// are one cue on one event; each runs on its own emptied yard.
import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { COMPONENT_TYPES, type ComponentType, FIRE_CUE } from "../constants";
import {
  captureReplay,
  createHarness,
  openYard,
  type Harness,
} from "../harness";
import { beforeFrame, fireOnce, onFrame, settle } from "./cues";

/** Every type `specs/ui.md` binds to the discharge cue: the Arc-Node and the Discharge Rig. */
const TYPES: readonly ComponentType[] = COMPONENT_TYPES.filter(
  (type) => FIRE_CUE[type] === "fire-discharge",
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("sounds on the frame each of the two fires, and not before", async () => {
  await openYard(h, { wave: 1 });
  await settle(h);

  for (const type of TYPES) {
    const shot = await captureReplay(h, "discharge", () =>
      fireOnce(h, type, 1),
    );

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
