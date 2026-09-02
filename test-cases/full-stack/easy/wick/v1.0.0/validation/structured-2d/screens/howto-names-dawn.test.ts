// Wick — screens/howto-names-dawn: the how-to screen tells the player when the
// night ends.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`howto`": the
// screen covers "that the night ends at dawn, `10:00` on the clock, and that
// reaching it is the win". `10:00` is the run clock at `DAWN_TIME` (`600`)
// seconds drawn in the `m:ss` form the HUD and the end screens use
// (`specs/ui.md`), which this suite spells as `clockText(DAWN_TICK)`.
//
// WHAT IS READ. The strings the frame drew, for that one figure. Everything
// else the screen says is the build's own wording, so nothing else is read.
//
// THE DRIVE. The how-to screen posed through the debug surface and one frame;
// no menu is touched.
//
// THE TOLERANCE. The figure is exact, as a substring of a run of drawn text,
// so a build that writes it inside a sentence reads the same as one that
// draws it alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { DAWN_TICK, clockText } from "../constants";
import {
  captureStill,
  createHarness,
  drewText,
  poseScreen,
  type Harness,
} from "../harness";

/** The clock at dawn, as the game draws a clock (specs/ui.md). */
const DAWN_CLOCK = clockText(DAWN_TICK);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("draws the dawn clock on the how-to screen", async () => {
  h.reset();
  const posed = poseScreen(h, "howto");
  assertEqual(posed.screen, "howto", "the screen the frame is read on");

  const { calls } = await h.frameDraw();
  captureStill(h, "dawn");

  assertTrue(
    drewText(calls, DAWN_CLOCK),
    `the how-to screen drew ${DAWN_CLOCK}, the clock the night ends at (specs/ui.md, howto)`,
  );
});
