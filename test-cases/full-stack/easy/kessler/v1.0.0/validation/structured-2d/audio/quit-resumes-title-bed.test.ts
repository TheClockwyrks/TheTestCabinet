// audio/quit-resumes-title-bed — confirming QUIT brings the title bed back.
//
// specs/assets.md: "Confirming QUIT stops the play bed and the title bed
// resumes", over the beds' own table, where the title bed "Loops on" `title` and
// `howto`. This point is the resumption; the stopping half is
// `quit-stops-play-bed`, so a build that stops the play bed and never brings the
// title bed back is told from one that leaves both sounding.
//
// THE QUIT IS REACHED BY POSING THE HIGHLIGHT AND PRESSING `confirm`, not by
// walking down the menu: how the highlight moves is the `controls` category's
// point. The landing screen is read back too, so the bed is heard where the
// specification puts it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { BINDINGS, PAUSE_ITEMS } from "../constants";
import {
  advanceTicks,
  captureReplay,
  openHarness,
  poseMenu,
  startFreshSession,
  tap,
  type Harness,
} from "../harness";
import { BED_TITLE } from "./beds";

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

it("has the title bed looping again on the title screen", async () => {
  startFreshSession(h);
  await advanceTicks(h, 2);
  const posed = poseMenu(h, "paused", QUIT_ENTRY);
  assertEqual(
    posed.menu.index,
    QUIT_ENTRY,
    "QUIT highlighted before the confirm",
  );

  await captureReplay(h, "resumed", async () => {
    await tap(h, CONFIRM);
    await advanceTicks(h, 2);
  });

  assertEqual(h.snapshot().screen, "title", "the screen the quit returned to");
  assertTrue(h.looping(BED_TITLE), "the title bed sounding again on the title");
});
