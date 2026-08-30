// Arc Foundry — audio/fire-discharge: the discharge cue sounds on the frame an
// Arc-Node or a Discharge Rig fires, and on no frame before it.
//
// THE REQUIREMENT, from the cue table of `specs/ui.md`: `CUES.fireDischarge` is
// played when "an Arc-Node or a Discharge Rig fires", and each cue is played "on the
// frame its event happens, by the code that raised it, and at most once on that
// frame".
//
// WHAT MARKS THE EVENT. `specs/components.md` puts every shot on a travelling
// projectile, so the frame a projectile appears is the frame the structure fired.
//
// WHAT IS ASSERTED. That `fire-discharge` is among the cues the engine announced on
// the frame of the shot, and that nothing was announced on any frame before it.
// Each structure is stood up alone first and held with nothing in range, where
// `specs/components.md` says it "holds fire". The engine's event carries the cue's
// name, so a build that plays some other cue on the right event fails here.
//
// BOTH TYPES, BECAUSE THE REQUIREMENT NAMES BOTH. They are one point because they
// are one cue on one event; each runs on its own emptied yard.

import { afterEach, beforeEach, it } from "vitest";

import { CUES } from "../../src/constants";
import { assertContains, assertDeepEqual, assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  openYard,
  type Harness,
} from "../harness";
import { beforeFrame, fireOnce, names, onFrame, typesPlaying } from "./cues";

/** Every type `specs/ui.md` binds to the discharge cue: the Arc-Node and the Discharge Rig. */
const TYPES = typesPlaying(CUES.fireDischarge);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sounds on the frame each of the two fires, and not before", async () => {
  openYard(h, { wave: 1 });

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
      names(beforeFrame(shot.cues, shot.frame)),
      [],
      `no cue to sound while a ${type} holds fire with nothing in range ` +
        "(specs/ui.md)",
    );
    assertContains(
      names(onFrame(shot.cues, shot.frame)),
      CUES.fireDischarge,
      `the ${CUES.fireDischarge} cue on the frame a ${type} fires ` +
        "(specs/ui.md)",
    );
  }
});
