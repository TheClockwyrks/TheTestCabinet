// Arc Foundry — audio/fire-chain: the chain cue sounds on the frame a Coil fires,
// and on no frame before it.
//
// THE REQUIREMENT, from the cue table of `specs/ui.md`: `CUES.fireChain` is played
// when "a Coil fires", and each cue is played "on the update its event happens, and
// at most once on that update".
//
// WHAT MARKS THE EVENT. `specs/components.md` puts every shot on a travelling
// projectile, so the frame a projectile appears is the frame the Coil fired. The
// cue is bound to the FIRING rather than to the chain that resolves when the shot
// lands, which is what `specs/ui.md` says and what this drives.
//
// WHAT IS ASSERTED, AND WHAT CANNOT BE. That a sound was emitted, and on the frame
// of the shot rather than before it. The Coil is stood up alone first and held with
// nothing in range, where `specs/components.md` says it "holds fire", and every
// sound from that moment on is recorded. What cannot be separated from outside an
// engineless build is a build that plays the WRONG cue on the right event, because
// the name of a sound is not observable; that half is the reviewer's, by ear.
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

/** The one type `specs/ui.md` binds to the chain cue, per `FIRE_CUE`. */
const TYPES: ComponentType[] = (["coil"] as ComponentType[]).filter(
  (type) => FIRE_CUE[type] === "fire-chain",
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds on the frame a Coil fires, and not before", async () => {
  await h.armAudio();
  await openYard(h, { wave: 1 });
  await h.advance(SETTLE);

  for (const type of TYPES) {
    const shot = await captureReplay(h, "chain", () => fireOnce(h, type, 1));

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
