// states/gameover — game over reports the run and offers the menu.
//
// `specs/progression.md`: "Contact with no life in reserve ends the dive instead:
// `lives` is already `0`, and `screen` becomes `"gameover"`." `specs/ui.md` gives
// that screen as "the score the run finished on, the depth it reached, and the
// game-over menu", fixes the game-over menu as `PLAY AGAIN` then `MENU`, and
// routes `PLAY AGAIN` confirmed to `"countdown"` — where "the score returns to
// `0`, the lives to `START_LIVES` (`3`), and the depth to `1`".
//
// THE RUN IS SPENT THROUGH THE BUILD'S OWN CONTACT RULE. The board carries ONE
// hunter, and each attempt puts it on the forager's own tile and poses it into
// `"chase"`, which is contact as `specs/gameplay.md` defines it, and then waits
// for the build to take the life. Nothing here poses a life away or poses the
// screen.
//
// THE RUN IS GIVEN A SCORE WORTH READING. A dive that never eats anything
// finishes on `0`, and `0` appears in almost any run of text a screen draws, so
// the reading would pass on nothing. So one plankton and one bonus drifter are put
// under the forager first and eaten through the build's own rules, which puts the
// run on a three-figure score the screen has to carry. The board holds nothing
// else, so nothing wanders into the reading.
//
// WHAT IS ASSERTED OF THE COPY, AND WHAT IS NOT. `specs/ui.md` fixes the two menu
// items word for word, so those are matched as words. It fixes only that the
// score and the depth are SHOWN, never how they are written, so those two are
// matched as the digits the run finished on — the score's, and the depth's as a
// standalone number. A build is free to write `SCORE 00210` or `210 POINTS`.
//
// WHAT THIS DOES NOT DECIDE. That three catches cost three lives and the fourth
// ends the run, which is `scoring/three-lives`'; what a plankton or a drifter
// scores, which is `scoring/plankton`'s and `amber/drifter-score`'s.

import { afterEach, beforeEach, it } from "vitest";
import { GAMEOVER_ITEMS, START_LIVES } from "../../src/constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
  assertMatches,
} from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  CONFIRM_KEY,
  assertDrew,
  drawnText,
  frameOps,
  loseEveryLife,
} from "./screens";
import { poseMaze, spawnDrifter, spawnPredator } from "../fixtures";
import { parkForager } from "../scene";

/**
 * THE BOARD. A room for the forager, and a pocket across the rock for the one
 * hunter every staged catch below uses.
 */
const BOARD = ["F....", "", "P...."];

/** Frames spent taking the posed mouthful and the posed drifter, one each. */
const EAT_TICKS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ends the run on game over, reports it, and plays again", async () => {
  startPlaying(h);

  // A board with nothing on it but the forager, one plankton and one drifter —
  // and one hunter, added last, which is the one every staged catch below uses.
  const board = await poseMaze(h, BOARD);
  const home = board.mark("F");
  await parkForager(h, home);

  // A score worth reading off the screen, taken through the build's own scoring:
  // one plankton eaten and one bonus drifter, both put under the forager, which
  // is the contact specs/gameplay.md eats on.
  // Both stand on the tile AHEAD of the forager and its center is then moved into
  // that tile, which is the entry specs/gameplay.md eats on; a spare stands one
  // further on and is never eaten, so the mouthful below is not the one that
  // leaves none behind and clears the maze.
  const bite = { tx: home.tx + 1, ty: home.ty };
  h.debug.setPlankton(home.tx + 2, home.ty, true);
  h.debug.setPlankton(bite.tx, bite.ty, true);
  h.debug.setForagerTile(bite.tx, bite.ty);
  await h.advance(EAT_TICKS);
  await spawnDrifter(h, bite, { mind: false });
  await h.advance(EAT_TICKS);
  const scored = h.snapshot();

  // The hunter every attempt below stages its catch with, added after the score
  // is banked so nothing can take a life early. Each catch is POSED — the hunter
  // is put on the forager's own tile — so nothing here is about where it travels,
  // and its body is held while contact still costs a life
  // (specs/instrumentation.md).
  await spawnPredator(h, "lanternjaw", board.mark("P"), { travel: false });

  const over = await loseEveryLife(h);
  const ops = await frameOps(h);
  // Before the assertions, so a failing check still leaves the screen it read.
  captureStill(h, "gameover");

  await h.tap(CONFIRM_KEY); // PLAY AGAIN, the first item of the game-over menu.
  const again = h.snapshot();

  // The run really scored something, so the reading below is not of a zero.
  assertGreaterThan(
    scored.score,
    0,
    "the score the run had banked before its lives were spent, which is what " +
      "the game-over screen has to carry (specs/ui.md)",
  );

  assertEqual(
    over.screen,
    "gameover",
    "the screen contact with no life in reserve reaches (specs/progression.md)",
  );
  // The reserve really was spent, which is what makes the reading above a game
  // over rather than a screen that turned up early. The EXACT count is
  // `scoring/three-lives`' — specs/progression.md puts `lives` at `0` when the
  // run ends, and a build that hands out one life too many is that point's
  // finding — so this asks only that nothing was left.
  assertLessThanOrEqual(
    over.lives,
    0,
    "the lives in reserve when the run ended, which specs/progression.md has " +
      "already spent",
  );

  assertDrew(
    ops,
    String(over.score),
    "the score the run finished on, drawn on the game-over screen " +
      "(specs/ui.md)",
  );
  assertMatches(
    drawnText(ops),
    new RegExp(`(?<!\\d)${String(over.depth)}(?!\\d)`),
    "the depth the run reached, drawn on the game-over screen as a number of " +
      "its own (specs/ui.md)",
  );
  for (const item of GAMEOVER_ITEMS) {
    assertDrew(
      ops,
      item,
      `an item of the game-over menu, which is ${GAMEOVER_ITEMS.join(" then ")} (specs/ui.md)`,
    );
  }

  assertEqual(
    again.screen,
    "countdown",
    "the screen PLAY AGAIN confirmed opens the fresh dive on (specs/ui.md)",
  );
  assertEqual(again.depth, 1, "the depth a fresh dive begins at (specs/ui.md)");
  assertEqual(again.score, 0, "the score a fresh dive begins at (specs/ui.md)");
  assertEqual(
    again.lives,
    START_LIVES,
    "the lives in reserve a fresh dive begins with (specs/ui.md)",
  );
});
