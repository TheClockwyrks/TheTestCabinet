// Meltdown — screens/difficulty-shows-its-figures: each difficulty row shows what
// choosing it would change.
//
// THE RULE. `specs/screens.md`, on `difficultyselect`: it "Draws the three rows of
// `DIFFICULTY_ITEMS`: `EASY`, `MEDIUM`, and `HARD`. Each row draws that
// difficulty's starting money and its wave count, before it is chosen."
// `specs/modes.md` fixes the six figures: `350`/`15`, `250`/`20` and `200`/`26`.
//
// ALL SIX AT ONCE, ON ONE FRAME. The sentence is about each ROW, not about the
// highlighted row: a player choosing a difficulty is choosing between three
// numbers they can see, and a screen that shows only the figures of the row the
// highlight happens to sit on has not drawn them on each row. So one frame is read
// with the highlight where `reset` puts it, on row `0`, and all six figures must be
// on it.
//
// EACH FIGURE IS ASSERTED SEPARATELY, naming its difficulty and which of the two
// it is, so a failed grade says "HARD's wave count" rather than "the list is
// wrong".
//
// THE FIGURES ARE LOOKED FOR AS NUMBERS, not as strings, because
// `specs/screens.md` fixes the three ROWS as constants and fixes nothing about how
// a figure beside one is labelled or ordered: `350 MONEY 15 WAVES`, `$350 · 15
// waves` and `MONEY 350 / WAVES 15` all draw the same pair.
//
// THE SIX FIGURES TELL EVERY WRONG MODEL APART, because no two of them are equal:
// a build drawing only the highlighted row's pair misses four; a build drawing one
// difficulty's pair against all three rows misses four; a build drawing the wave
// counts and no money misses three; a build with the money and waves columns
// swapped between two rows still misses none, which is the honest limit of a
// reading that cannot locate a row, and the reviewer has the picture.
//
// THE LIVE RUN'S OWN FIGURES ARE POSED OUT OF THE WAY, and this is the point's one
// piece of arrangement. `reset` leaves the run on Containment at MEDIUM with `250`
// money and `20` lives (`specs/instrumentation.md`), and those two numbers are
// exactly MEDIUM's starting money and MEDIUM's wave count. A build that drew the
// LIVE money and lives somewhere on this screen would then satisfy MEDIUM's row
// while having drawn nothing about MEDIUM at all. So the run's money and lives are
// posed to `7` and `3`, which no figure on this screen equals: after that, every
// number this check finds was drawn because the screen draws the difficulty table.
//
// THE WHOLE STAGE IS READ, unlike the two end screens. The build panel is drawn
// only over a run (`specs/floor.md` gives it "every readout and every control
// `specs/hud.md` states"), and `difficultyselect` is not a run — so no readout
// stands behind this screen that could answer for it, and a build free to lay its
// list out across the full `1280` must not be failed for putting a row's figures
// past `x` `986`.
//
// THE SCREEN IS POSED, because what the list DRAWS does not depend on how a player
// got to it — reaching it is `screens.containment-opens-difficulty-select`'s
// reading, the three names are `screens.difficulty-lists-three`'s, and what
// confirming a row does is `screens.difficulty-starts-the-run`'s. "Before it is
// chosen" is read here as the screen still standing at `difficultyselect` with
// nothing started when the figures are read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DIFFICULTIES, DIFFICULTY_ITEMS, DIFFICULTY_TABLE } from "../constants";
import {
  captureStill,
  createHarness,
  drawnText,
  type Harness,
} from "../harness";
import { drewNumber } from "./copy";

/**
 * The money the live run is posed with while the list is read.
 *
 * A sentinel, not a figure of the game: it is none of the six the table fixes and
 * none of the starting lives, so a live-money readout drawn anywhere on this
 * screen cannot be mistaken for a row's own starting money.
 */
const SENTINEL_MONEY = 7;

/** The same, for the live lives, which `START_LIVES` would otherwise make `20`. */
const SENTINEL_LIVES = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws every difficulty's starting money and wave count before one is chosen", async () => {
  const { debug } = h;
  await debug.reset();
  await debug.setMoney(SENTINEL_MONEY);
  await debug.setLives(SENTINEL_LIVES);
  await debug.setScreen("difficultyselect");

  const calls = await h.frameCalls();
  await captureStill(h, "figures");

  const posed = await h.snapshot();
  assertEqual(
    posed.screen,
    "difficultyselect",
    "the screen the figures are read on, with nothing yet chosen",
  );
  assertEqual(
    posed.money,
    SENTINEL_MONEY,
    "the live money while the list is read",
  );
  assertEqual(
    posed.lives,
    SENTINEL_LIVES,
    "the live lives while the list is read",
  );

  const runs = drawnText(calls);
  for (const [row, difficulty] of DIFFICULTIES.entries()) {
    const figures = DIFFICULTY_TABLE[difficulty];
    for (const [what, value] of [
      ["starting money", figures.money],
      ["wave count", figures.waves],
    ] as const) {
      assertEqual(
        drewNumber(runs, value),
        true,
        `${DIFFICULTY_ITEMS[row]}'s ${what} (${value}) on the difficulty list, ` +
          `where each row draws its own before it is chosen (specs/screens.md, ` +
          `specs/modes.md); what the screen drew was ${JSON.stringify(runs)}`,
      );
    }
  }
});
