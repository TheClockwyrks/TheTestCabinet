// presentation/screen-text-is-legible — every screen draws text of its own.
//
// THE RULE. `specs/ui.md` opens with it: "Every piece of text a screen shows is
// legible against whatever sits behind it at the logical field size, `1280 x 720`."
// `specs/overview.md` says the same of the whole build: "Every readout and every
// screen's text is legible against its background at the logical field size." The
// screens are where the game is explained, paused and ended, and a screen that shows
// a player nothing has a game nobody can navigate.
//
// WHAT IS DECIDED HERE, AND WHAT IS NOT. Legibility is a contrast between a mark and
// the ground under it, and `specs/overview.md` leaves the palette and the type to the
// build, so how well a build's text reads is the picture the reviewer judges. What a
// script decides is the half beneath it: each of the five screens submits text for a
// player to read.
//
// A DRAW CALL RATHER THAN A PIXEL. The reading is the text the BUILD submitted on the
// screen's own frame, which says what the build did rather than what one frame
// happened to look like. Runs of nothing but whitespace are dropped, because a build
// that submits an empty string has drawn a player no text.
//
// ALL FIVE SCREENS, IN ONE CHECK, because the manifest declares one item over the
// five and a failure names which of them it read (`specs/ui.md`: the game is on
// exactly one of `title`, `howto`, `playing`, `paused` and `gameover` at a time).
// Each is reached through the debug surface and read as it stands, with the score and
// the wave posed on the two screens that show them so there is something to draw.

import { afterEach, beforeEach, it } from "vitest";
import { assertTrue } from "../assert";
import { type Screen } from "../constants";
import {
  captureStill,
  createHarness,
  presentCalls,
  startPlaying,
  textDraws,
  type Harness,
} from "../harness";

/** The score posed on the screens that show one. */
const SCORE = 730;

/** The wave posed on the screen that shows one. */
const WAVE = 4;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

/** Put the game on `screen`, with whatever that screen needs to have text on it. */
async function pose(h: Harness, screen: Screen): Promise<void> {
  if (screen === "title" || screen === "howto") {
    await h.debug.reset();
    await h.debug.setScreen(screen);
    await h.debug.setMenuIndex(0);
    return;
  }
  await startPlaying(h);
  await h.debug.setScore(SCORE);
  await h.debug.setWave(WAVE);
  if (screen !== "playing") {
    await h.debug.setScreen(screen);
    await h.debug.setMenuIndex(0);
  }
}

it("draws text on every one of the five screens", async () => {
  const screens: Screen[] = ["title", "howto", "playing", "paused", "gameover"];

  for (const screen of screens) {
    await pose(harness, screen);
    const runs = textDraws(await presentCalls(harness)).filter(
      (run) => run.text.trim() !== "",
    );
    // Overwritten each time round, so what is kept is the last screen that RAN,
    // including the one an assertion below is about to fail on.
    await captureStill(harness, "screens");

    assertTrue(
      runs.length > 0,
      `the ${screen} screen drawing some text at all (specs/ui.md)`,
    );
  }
});
