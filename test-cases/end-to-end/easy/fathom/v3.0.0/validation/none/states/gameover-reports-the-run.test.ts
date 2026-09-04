// states/gameover-reports-the-run — game over reports the run it ended.
//
// specs/ui.md gives the game-over screen as "the score the run finished on, the
// depth it reached, and the game-over menu". This point is the first two: what
// the screen says about the run a player just lost.
//
// THE RUN IS SPENT THROUGH THE BUILD'S OWN CONTACT RULE. Each attempt puts the
// roster's first hunter on the forager's own tile and poses it into `"chase"`,
// which is contact as specs/gameplay.md defines it, and then waits for the build
// to take the life. Nothing here poses a life away or poses the screen, because
// the figures the screen has to carry are the ones the run actually finished on.
//
// THE RUN IS GIVEN A SCORE AND A DEPTH WORTH READING. A dive that never eats
// anything finishes on `0`, and `0` appears in almost any run of text a screen
// draws, so the reading would pass on nothing; a run that never descends finishes
// at depth `1`, which is just as cheap. So the forager takes its opening mouthful
// and one bonus drifter posed on its own tile, and the depth is posed deeper,
// before the lives are spent. The drifter's mind is off so it is eaten where it
// was put rather than drifting off first (specs/instrumentation.md: with a mind
// off, "plankton and drifters are still eaten and still score").
//
// WHAT IS ASSERTED OF THE COPY, AND WHAT IS NOT. specs/ui.md fixes only that the
// score and the depth are SHOWN, never how they are written, so the score is
// matched as the digits the run finished on and the depth as a standalone number.
// A build is free to write `SCORE 00210` or `210 POINTS`.
//
// WHAT THIS DOES NOT DECIDE. That three catches cost three lives and the fourth
// ends the run, which is `scoring.three-lives`'; what the menu draws, which is
// `states.gameover-menu-items`'.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual, assertGreaterThan, assertMatches } from "../assert";
import { spawnDrifter } from "../fixtures";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { assertDrew, drawnText, frameOps, loseEveryLife } from "./screens";

/** Ticks spent taking the opening mouthful and the posed drifter, one each. */
const EAT_TICKS = 1;

/** The depth the run is posed onto, so the reading is not of a bare `1`. */
const POSED_DEPTH = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the score the run finished on and the depth it reached", async () => {
  await startPlaying(h);
  await h.debug.setDepth(POSED_DEPTH);

  // A score worth reading off the screen, taken through the build's own scoring:
  // the plankton the forager opens on, and one bonus drifter posed under it.
  await h.advance(EAT_TICKS);
  const standing = (await h.snapshot()).forager;
  await spawnDrifter(h, { tx: standing.tx, ty: standing.ty }, { mind: false });
  await h.advance(EAT_TICKS);
  const scored = await h.snapshot();

  const over = await loseEveryLife(h);
  const ops = await frameOps(h);
  // Before the assertions, so a failing check still leaves the screen it read.
  await captureStill(h, "gameover");

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
    "the score the run finished on, drawn on the game-over screen (specs/ui.md)",
  );
  assertMatches(
    drawnText(ops),
    new RegExp(`(?<!\\d)${String(over.depth)}(?!\\d)`),
    "the depth the run reached, drawn on the game-over screen as a number of " +
      "its own (specs/ui.md)",
  );
});
