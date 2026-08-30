// Arc Foundry — audio/fire-chain: the chain cue sounds on the frame a Coil fires,
// and on no frame before it.
//
// THE REQUIREMENT, from the cue table of `specs/ui.md`: `CUES.fireChain` is played
// when "a Coil fires", and each cue is played "on the frame its event happens, by
// the code that raised it, and at most once on that frame".
//
// WHAT MARKS THE EVENT. `specs/components.md` puts every shot on a travelling
// projectile, so the frame a projectile appears is the frame the Coil fired. The
// cue is bound to the FIRING rather than to the chain that resolves when the shot
// lands, which is what `specs/ui.md` says and what this drives.
//
// WHAT IS ASSERTED. That `fire-chain` is among the cues the engine announced on the
// frame of the shot, and that nothing was announced on any frame before it. The
// Coil is stood up alone first and held with nothing in range, where
// `specs/components.md` says it "holds fire". The engine's event carries the cue's
// name, so a build that plays some other cue on the right event fails here.

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

/** Every type `specs/ui.md` binds to the chain cue: the Coil. */
const TYPES = typesPlaying(CUES.fireChain);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sounds on the frame a Coil fires, and not before", async () => {
  openYard(h, { wave: 1 });

  for (const type of TYPES) {
    const shot = await captureReplay(h, "chain", () => fireOnce(h, type, 1));

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
      CUES.fireChain,
      `the ${CUES.fireChain} cue on the frame a ${type} fires (specs/ui.md)`,
    );
  }
});
