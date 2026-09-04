// audio/quit-stops-play-bed — confirming QUIT stops the play bed.
//
// specs/assets.md: "Confirming QUIT stops the play bed and the title bed
// resumes." This point is the stopping half; the resumption is
// `quit-resumes-title-bed`, so a build that stops the play bed and never brings
// the title bed back is told from one that leaves both sounding.
//
// THE QUIT IS REACHED BY POSING THE HIGHLIGHT AND PRESSING `confirm`, not by
// walking down the menu: how the highlight moves is the `controls` category's
// point, and a build whose only fault is its `down` key must fail there rather
// than here. The session under the pause menu is started through the harness's
// own sequence, so the title menu is never touched either.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, BED_PATHS, PAUSE_ITEMS } from "../constants";
import {
  advanceTicks,
  captureReplay,
  openHarness,
  poseMenu,
  startFreshSession,
  tap,
  type Harness,
} from "../harness";

/** The key that carries `confirm` alone — `Space` also carries `launch`. */
const CONFIRM = BINDINGS.confirm[1];
/** Entry 1 of the pause menu: QUIT. */
const QUIT_ENTRY = PAUSE_ITEMS.indexOf("QUIT");

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the play bed silent after the quit", async () => {
  startFreshSession(h);
  await advanceTicks(h, 2);
  const posed = poseMenu(h, "paused", QUIT_ENTRY);
  assertEqual(
    posed.menu.index,
    QUIT_ENTRY,
    "QUIT highlighted before the confirm",
  );

  await captureReplay(h, "stopped", async () => {
    await tap(h, CONFIRM);
    await advanceTicks(h, 2);
  });

  assertEqual(h.snapshot().screen, "title", "the screen the quit returned to");
  assertEqual(
    h.looping(BED_PATHS.play),
    false,
    "the play bed sounding after the quit",
  );
});
