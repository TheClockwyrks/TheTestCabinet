// presentation/hud-lives — the lives readout counts the critter currently
// crossing, so a fresh run reads three and a run that has lost one reads two.
//
// specs/ui.md's HUD table gives the second readout "`lives`, the lives the run has
// left counting the critter currently crossing, so a run that has lost none reads
// `3`", inside the bar specs/strait.md puts at `y` in `[0, HUD_H]`.
// specs/progression.md is where the three come from and where a death takes one.
//
// THE OFF-BY-ONE IS THE WHOLE POINT, which is why the reading is taken twice: a
// build that shows the lives IN RESERVE draws `2` on a fresh run and `1` after the
// first death, and passes any check that only watched the figure go down. Reading
// `START_LIVES` (`3`) before and `2` after is what tells the two apart.
//
// THE DEATH IS A REAL ONE. The critter is posed onto an uncovered water tile,
// which specs/water.md makes a drowning, and the point then waits for the run to
// come back to a live crossing on its own — so what the second reading shows is a
// run that has genuinely lost a life, not a posed `lives` field. `setLives` would
// have decided the same figure without deciding that the game counts it.
//
// EITHER PRESENTATION IS ACCEPTED, because specs/assets.md permits both: "a lives
// icon in the HUD may reuse one of these frames", and specs/ui.md leaves the
// arrangement and styling to the build. So the readout is satisfied by a run of
// text inside the bar that reads as the figure, OR by exactly that many draws of
// `assets/crosser/` inside the bar. A build that draws three little critters up
// there has shown the lives as plainly as one that draws a `3`.
//
// NOTHING ELSE IN THIS BAR CAN SUPPLY THOSE FIGURES: the score is `0`, the level
// `1` of `8`, and the level-1 crossing timer `30` seconds, none of which reads as
// `3` or `2`.

import { afterEach, beforeEach, it } from "vitest";
import { HUD_H, START_LIVES } from "../../src/constants";
import { assertEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  drawFrame,
  startCrossing,
  ticksFor,
  type DrawCall,
  type Harness,
} from "../harness";
import { describeRuns, hudRuns, runsShowing } from "./readout";
import { spritesOf } from "./sprites";

/** Where the critter is put to drown: open water, well inside the strait. */
const DROWN_COL = 20;
const DROWN_ROW = 6;

/**
 * How long the point waits for the run to come back to a live crossing.
 *
 * Three seconds. specs/progression.md holds a death for `DEATH_PAUSE` (`0.9` s)
 * before the respawn, so this is a ceiling on a build that never comes back rather
 * than a figure the point asserts — `progression/death-pause` is what decides the
 * length of the hold.
 */
const RESPAWN_DEADLINE_TICKS = ticksFor(3);

/** How the frame showed the lives: as a figure, as icons, or not at all. */
interface Shown {
  digits: boolean;
  icons: number;
  drew: string;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws three lives on a fresh crossing and two after the first death", async () => {
  const shown = async (lives: number, calls: DrawCall[]): Promise<Shown> => {
    const runs = hudRuns(h, calls);
    const sprites = await spritesOf(h, calls);
    return {
      digits: runsShowing(runs, lives).length >= 1,
      // Draws of the critter's own art inside the bar: the icon presentation
      // specs/assets.md allows. Nothing of the strait is drawn up here.
      icons: sprites.filter(
        (sprite) =>
          sprite.image.y >= 0 &&
          sprite.image.y <= HUD_H &&
          sprite.matches.some((entry) => entry.folder === "crosser"),
      ).length,
      drew: describeRuns(runs),
    };
  };

  startCrossing(h);
  const fresh = h.snapshot();
  const opening = await shown(START_LIVES, await drawFrame(h));
  captureStill(h, "hud");

  // A real death: an uncovered water tile is a drowning (specs/water.md).
  h.debug.setCritterTile(DROWN_COL, DROWN_ROW);
  const back = await h.until(
    (snapshot) =>
      snapshot.lives === START_LIVES - 1 && snapshot.phase === "crossing",
    { maxFrames: RESPAWN_DEADLINE_TICKS },
  );
  const after = await shown(START_LIVES - 1, await drawFrame(h));

  // The situation: three lives before, and a death really took one.
  assertEqual(
    fresh.lives,
    START_LIVES,
    `a fresh crossing has START_LIVES (${START_LIVES}) lives ` +
      `(specs/progression.md)`,
  );
  assertTrue(
    back.hit,
    `the drowning cost a life and the crossing resumed within three seconds ` +
      `(specs/progression.md) — the run reported ${back.snapshot.lives} ` +
      `lives in phase ${back.snapshot.phase}`,
  );

  assertTrue(
    opening.digits || opening.icons === START_LIVES,
    `the HUD bar showing START_LIVES (${START_LIVES}) on a fresh crossing — ` +
      `as a run of text reading ${START_LIVES}, or as ${START_LIVES} draws ` +
      `of assets/crosser/ inside the bar (specs/ui.md, specs/assets.md); the ` +
      `bar drew ${opening.drew} and ${opening.icons} critter icons`,
  );
  assertTrue(
    after.digits || after.icons === START_LIVES - 1,
    `the HUD bar showing ${START_LIVES - 1} after the first death, which is ` +
      `the lives counting the critter currently crossing (specs/ui.md); the ` +
      `bar drew ${after.drew} and ${after.icons} critter icons`,
  );
});
