// presentation/overlay-shows-screen — the overlay reports the screen and mode.
//
// THE RULE. specs/instrumentation.md, "Diagnostics": the build registers "the
// current `screen` and the deal mode" among the values the debug overlay shows.
// Under this engine registering them is the whole of Cascade's part — the panel,
// the `Backquote` key that raises it and its default-off state are the engine's
// — so what this point decides is exactly what the build owns.
//
// WHAT IT DECIDES, AND WHAT IT LEAVES ALONE. That those two sources are
// registered and read the live game. The other registrations are
// `overlay-shows-pile-counts`, `overlay-shows-drag` and `overlay-shows-cascade`,
// so a build missing one registration is docked once and a grade names which.
// That raising the panel changes nothing is the engine's under this engine and
// is graded on `none` alone.
//
// THE SCREEN IS READ ON TWO SCREENS, and that is the design. A build whose
// source returns a constant, or which prints the screen it opened on, answers
// the first reading and fails the second; a build whose source reads the live
// state answers both. The two chosen are `playing` and `title`, which are the
// values specs/state.md gives the field and ordinary words either way, so
// nothing here rests on a build spelling a screen the way this check would.
//
// THE ENGINE'S OWN TWO LINES ARE DROPPED, in `./overlay`. That matters
// especially here: the engine writes `phase` on its world line, and a game mode
// sitting in a phase of its own could otherwise answer for a `screen` source the
// build never registered.
//
// THE DEAL MODE IS ACCEPTED IN EITHER SPELLING. specs/instrumentation.md asks
// for "the deal mode" and specs/stock.md gives the build both an id
// (`DEAL_MODE`) and a label (`DEAL_MODE_LABEL`); the snapshot reports both, and
// a panel carrying either has reported the deal mode. Which literal the TITLE
// SCREEN and the HUD draw is the variant's own point, not this one.
//
// THE WORLD IT POSES. `openTable` puts the game on `playing` with all thirteen
// piles empty, and `setScreen` moves it to `title`. Nothing else is touched.

import { afterEach, beforeEach, it } from "vitest";
import {
  captureStill,
  createHarness,
  openTable,
  toggleOverlay,
  type Harness,
} from "../harness";
import { assertWord, overlayLines } from "./overlay";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the live screen and the deal mode on the overlay", async () => {
  openTable(h);
  const { dealMode, dealModeLabel } = h.snapshot();

  const beforePlaying = await h.drawFrame();
  const afterPlaying = await toggleOverlay(h);
  captureStill(h, "overlay");
  const playing = overlayLines(beforePlaying, afterPlaying);

  assertWord(playing, "playing", "the screen the game is on");
  if (
    !playing.some((line) => line.toLowerCase().includes(dealMode.toLowerCase()))
  ) {
    assertWord(playing, dealModeLabel, "this build's deal mode");
  }

  h.debug.setScreen("title");
  const beforeTitle = await toggleOverlay(h);
  const afterTitle = await toggleOverlay(h);
  assertWord(
    overlayLines(beforeTitle, afterTitle),
    "title",
    "the screen the game moved to, so the source reads the live state rather " +
      "than the screen the game opened on",
  );
});
