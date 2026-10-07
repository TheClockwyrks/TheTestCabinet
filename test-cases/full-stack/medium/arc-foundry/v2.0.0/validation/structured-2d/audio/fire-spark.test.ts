// Arc Foundry — audio/fire-spark: the spark cue sounds on the frame an Emitter
// fires, and on no frame before it.
//
// THE REQUIREMENT, from the cue table of `specs/ui.md`: `CUES.fireSpark` is played
// when "an Emitter fires", and each cue is played "on the frame its event happens,
// by the code that raised it, and at most once on that frame". `specs/assets.md`
// adds that `fire-spark` "plays several times a second at a high fire rate, so it
// is short and does not build up", which is the Emitter's stated `4.5` shots per
// second.
//
// WHAT MARKS THE EVENT. `specs/components.md` puts every shot on a travelling
// projectile, so the frame a projectile appears is the frame the structure fired.
//
// WHAT IS ASSERTED. That `fire-spark` is among the cues the engine announced on
// the frame of the shot, and that nothing was announced on any frame before it.
// The Emitter is stood up alone first and held with nothing in range, where
// `specs/components.md` says it "holds fire". The engine's event carries the cue's
// name, so a build that plays some other cue on the right event fails here.

import { afterEach, beforeEach, it } from "vitest";
import { CUES } from "../constants";
import { assertContains, assertDeepEqual, assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  openYard,
  type Harness,
} from "../harness";
import { beforeFrame, fireOnce, names, onFrame, typesPlaying } from "./cues";

/** Every type `specs/ui.md` binds to the spark cue: the Emitter. */
const TYPES = typesPlaying(CUES.fireSpark);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sounds on the frame an Emitter fires, and not before", async () => {
  openYard(h, { wave: 1 });

  for (const type of TYPES) {
    const shot = await captureReplay(h, "spark", () => fireOnce(h, type, 1));

    assertEqual(
      shot.fired,
      true,
      `a Scrap ${type} with a unit inside its range to fire within four ` +
        "seconds (specs/components.md)",
    );
    assertDeepEqual(
      names(beforeFrame(shot.cues, shot.frame)),
      [],
      `no cue to sound while a ${type} holds fire with nothing in range ` +
        "(specs/ui.md)",
    );
    assertContains(
      names(onFrame(shot.cues, shot.frame)),
      CUES.fireSpark,
      `the ${CUES.fireSpark} cue on the frame a ${type} fires (specs/ui.md)`,
    );
  }
});
