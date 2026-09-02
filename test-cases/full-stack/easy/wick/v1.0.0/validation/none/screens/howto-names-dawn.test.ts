// screens/howto-names-dawn — the how-to screen names the clock the night ends
// at.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("`howto`"): the screen covers
// "that the night ends at dawn, `10:00` on the clock, and that reaching it is
// the win". `HOWTO_DAWN_CLOCK` is that figure. It is the run clock's own
// format, "as `m:ss`, counting up from `0:00` in whole seconds, the seconds
// always two digits" (specs/ui.md — "`playing`"), at `DAWN_TIME` (`600`)
// seconds (specs/world.md — "Fallen and dawn").
//
// WHY THE WORLD IS POSED AS IT IS. Nothing but the screen: `setScreen("howto")`
// "Enters the how-to screen exactly as confirming `HOW TO PLAY` does", so no
// menu is touched on the way, and one frame is run and read.
//
// THE TOLERANCE. The words around it are the build's, so only the figure is
// looked for, folded and across consecutive runs of text. `10:00` carries its
// colon, which folding keeps, so it is not matched by a stray digit.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOWTO_DAWN_CLOCK } from "../constants";
import {
  captureStill,
  createHarness,
  poseScreen,
  type Harness,
} from "../harness";
import { assertShows, shown } from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws 10:00, the clock the night ends at", async () => {
  const howto = await poseScreen(h, "howto");
  assertEqual(howto.screen, "howto", "the screen the frame is read on");

  const page = await shown(h);
  await captureStill(h, "dawn");

  assertShows(page, HOWTO_DAWN_CLOCK, "the how-to screen");
});
