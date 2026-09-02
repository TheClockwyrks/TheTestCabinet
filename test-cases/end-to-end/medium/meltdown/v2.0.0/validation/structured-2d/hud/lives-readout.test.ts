// hud/lives-readout — the panel draws the lives remaining, and the readout
// follows them.
//
// THE RULE. specs/hud.md, The status readouts: the Lives readout is labelled
// `HUD_LIVES_LABEL` (`LIVES`) and shows "The lives remaining", and "Each readout
// follows its value as it changes."
//
// THE SAME READING AS `hud/money-readout`, ON THE OTHER READOUT, and it is its
// own point because a build with a working money readout and a frozen lives
// readout must grade differently from one with both working: the label and the
// field are different, so each is decided separately.
//
// WHY THESE TWO NUMBERS. `17` and `13` are inside the range a run's lives
// actually take — `START_LIVES` is `20` — and neither is equal to any other
// number this panel can draw: not a build cost, not a footprint side, not the
// wave or the wave count, not the countdown, and not one of the coming Mote
// wave's figures. `setLives` "triggers no game over: the loss belongs to the leak
// path, and this is a precondition" (specs/instrumentation.md), so posing them
// moves nothing but the readout.

import { afterEach, beforeEach, it } from "vitest";
import { HUD_LIVES_LABEL } from "../constants";
import { assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";
import { readPanel, reads, saysWord } from "./panel";

/** The lives posed first. */
const FIRST = 17;

/** The lives posed second, which the readout must move to. */
const SECOND = 13;

/** Lives are a whole count, so only a trailing decimal point is allowed for. */
const EXACT = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the lives in the panel and follows setLives", async () => {
  startRun(h);

  h.debug.setLives(FIRST);
  const first = await readPanel(h);
  captureStill(h, "lives");

  h.debug.setLives(SECOND);
  const second = await readPanel(h);

  assertTrue(
    saysWord(first, HUD_LIVES_LABEL),
    `the panel to draw the ${HUD_LIVES_LABEL} label (specs/hud.md)`,
  );
  assertTrue(
    reads(first, FIRST, EXACT),
    `the panel to read ${FIRST} with the lives at ${FIRST} (specs/hud.md)`,
  );
  assertTrue(
    reads(second, SECOND, EXACT),
    `the panel to read ${SECOND} once the lives moved to ${SECOND}`,
  );
  assertTrue(
    !reads(second, FIRST, EXACT),
    `the panel to have stopped reading ${FIRST} once the lives moved to ` +
      `${SECOND}`,
  );
});
