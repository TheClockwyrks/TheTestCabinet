// states/gameover — game over reports the run and offers the menu.
//
// `specs/progression.md`: "Contact with no life in reserve ends the dive instead:
// `lives` is already `0`, and `screen` becomes `"gameover"`." `specs/ui.md` gives
// that screen as "the score the run finished on, the depth it reached, and the
// game-over menu", fixes the game-over menu as `PLAY AGAIN` then `MENU`, and
// routes `PLAY AGAIN` confirmed to `"countdown"` — where "the score returns to
// `0`, the lives to `START_LIVES` (`3`), and the depth to `1`".
//
// THE RUN IS SPENT THROUGH THE BUILD'S OWN CONTACT RULE. Each attempt puts the
// roster's first hunter on the forager's own tile and poses it into `"chase"`,
// which is contact as `specs/gameplay.md` defines it, and then waits for the
// build to take the life. Nothing here poses a life away or poses the screen.
//
// THE RUN IS GIVEN A SCORE WORTH READING. A dive that never eats anything
// finishes on `0`, and `0` appears in almost any run of text a screen draws, so
// the reading would pass on nothing. So the forager takes its opening mouthful
// and one bonus drifter posed on its own tile first, which puts the run on a
// three-figure score the screen has to carry. That drifter's mind is off
// (`specs/instrumentation.md`: with it off a drifter is "still eaten by a forager
// whose tile it shares, and still worth the ordinary bonus"), so it is eaten where
// it was put rather than wherever one tick of wander carried it.
//
// WHAT IS ASSERTED OF THE COPY, AND WHAT IS NOT. `specs/ui.md` fixes the two menu
// items word for word, so those are matched as words. It fixes only that the
// score and the depth are SHOWN, never how they are written, so those two are
// matched as the digits the run finished on — the score's, and the depth's as a
// standalone number. A build is free to write `SCORE 00210` or `210 POINTS`.
//
// WHAT THIS DOES NOT DECIDE. That three catches cost three lives and the fourth
// ends the run, which is `scoring/three-lives`'; what a plankton or a drifter
// scores, which is `scoring/plankton`'s and `amber/drifter-score`'s. So the
// reserve the run ended on is READ — `loseEveryLife` waits out a catch at a time
// until the screen turns — and never asserted here: a build that granted a fourth
// life still reaches game over, and the item that owns the count is the one that
// should say so.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertMatches } from "../assert";
import { GAMEOVER_ITEMS, START_LIVES } from "../constants";
import { spawnDrifter } from "../fixtures";
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

/** Frames spent taking the opening mouthful and the posed drifter, one each. */
const EAT_TICKS = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ends the run on game over, reports it, and plays again", async () => {
  await startPlaying(h);

  // A score worth reading off the screen, taken through the build's own
  // scoring: the plankton the forager opens on, and one bonus drifter posed
  // under it.
  await h.advance(EAT_TICKS);
  const standing = h.snapshot().forager;
  await spawnDrifter(h, standing, { mind: false });
  await h.advance(EAT_TICKS);
  const scored = h.snapshot();

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
