// Deepcore — rocket/installed-components-are-permanent: what is on the pad stays
// on the pad.
//
// `specs/rocket.md`: "Installed components are permanent. They survive a death in
// either mode and cannot be un-fabricated or refunded." `specs/modes.md` says the
// same from the death's side: a death "leaves every installed rocket component
// installed", in both modes.
//
// So a death is driven twice over, once in each mode, from the same posed
// checklist, and the list is read back unchanged each time — the same components
// in the same order, with the summary agreeing on the count. Both modes are one
// requirement here because the specification states permanence as one rule that
// the mode does not touch.
//
// The death itself is the game's: the hull is posed at `0`, which
// `specs/instrumentation.md` says "is not itself a death: the game's own
// continuous check is what ends the expedition, on the next update".

import { afterEach, beforeEach, it } from "vitest";
import { MODES, ROCKET_COMPONENT_IDS } from "../constants";
import { assertDeepEqual, assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { openPadScene, runUntilScreenLeaves } from "./pad-scene";

/** How many components stand on the pad when the miner dies. */
const INSTALLED = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps every installed component through a death in either mode", async () => {
  for (const mode of MODES) {
    openPadScene(h);
    h.debug.setMode(mode);
    h.debug.setPanel(null);
    h.debug.setRocketInstalled(INSTALLED);
    h.debug.setHull(0);

    const over = await runUntilScreenLeaves(h, "in-mine");

    assertEqual(over.screen, "game-over", `the screen a ${mode} death ends on`);
    assertEqual(over.mode, mode, "the mode the expedition was played in");
    assertDeepEqual(
      over.rocket.installed,
      ROCKET_COMPONENT_IDS.slice(0, INSTALLED),
      `the checklist after a ${mode} death`,
    );
    assertEqual(
      over.summary?.componentsInstalled,
      INSTALLED,
      `components the ${mode} summary counts`,
    );
  }

  captureStill(h, "kept");
});
