// audio/menu-move-cue — each move of the menu highlight plays the menu-move
// cue exactly once.
//
// specs/screens.md, on the menus: "`up` moves the highlight up one entry and
// `down` moves it down one, each wrapping past the end to the other, and each
// move plays the `menu-move` cue."
//
// THE SCENE IS THE TITLE MENU AT ITS BOOT STATE. reset() stands the game on
// `title` with the highlight on entry 0, and two moves are made — one down,
// one up — with the cue counted after each. The highlight's landing entry is
// read back with each move to pin the scenario at one move per tap: whether
// each bound key moves the highlight is the screens and controls categories'
// point, but a tap that moved the highlight twice or not at all would leave
// "exactly once per move" unreadable here, so the move count is grounded
// before its cue is counted.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS } from "../constants";
import {
  captureReplay,
  cuesNamed,
  onCue,
  openHarness,
  tap,
  type Harness,
} from "../harness";

/** The cue specs/screens.md has each highlight move play. */
const CUE = "menu-move";

/** The keys specs/controls.md binds to `down` and `up`. */
const DOWN = BINDINGS.down[0];
const UP = BINDINGS.up[0];

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds menu-move exactly once per highlight move", async () => {
  await h.armAudio();
  await h.reset();

  const cues = onCue(h);
  await captureReplay(h, "moves", async () => {
    await tap(h, DOWN);
    assertEqual((await h.snapshot()).menu.index, 1, "one down move made");
    assertEqual(
      cuesNamed(cues, CUE).length,
      1,
      `${CUE} plays for the down move`,
    );

    await tap(h, UP);
    assertEqual((await h.snapshot()).menu.index, 0, "one up move made");
    assertEqual(
      cuesNamed(cues, CUE).length,
      2,
      `${CUE} plays once more for the up move`,
    );
  });
});
