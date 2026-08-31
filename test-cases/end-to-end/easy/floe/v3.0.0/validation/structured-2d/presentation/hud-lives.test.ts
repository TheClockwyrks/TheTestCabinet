// Floe — presentation/hud-lives: the HUD's lives readout counts, and a different
// count is drawn differently.
//
// specs/ui.md's HUD table: "Lives | `lives`, the lives the run has left counting
// the critter currently crossing, so a run that has lost none reads `3`." What
// that asks of the drawing is that the readout FOLLOWS THE COUNT: a run on its
// last critter must not look like a run on its first.
//
// WHY THIS IS NOT READ AS TEXT. specs/ui.md leaves the HUD's "arrangement and
// styling" to the build, and a lives readout is one of the two the specification
// invites a build to draw without any text at all — three little critters in a
// row is exactly as conformant as the digit `3`, and demanding a digit would fail
// a perfectly good HUD. So the reading is the PIXELS OF THE HUD BAR: pose a
// count, read the bar, and require the bar to be drawn differently for a
// different count. No palette, no glyph, no arrangement and no position is
// required of the readout, because the specification fixes none.
//
// THREE COUNTS, ALL THREE PAIRS. `3` against `2` alone would pass a readout that
// merely says whether a life has been lost; `2` against `1` alone would pass one
// that says whether this is the last critter. Reading `3`, `2` and `1` and
// requiring all three drawings to differ is what makes the readout a COUNT — and
// `3`, `2` and `1` are the three counts a run actually passes through
// (specs/progression.md opens a run at `START_LIVES` and takes one per death).
//
// EACH COUNT IS READ FROM ITS OWN FRESH CROSSING, AT THE SAME TICK. The three
// frames are posed identically by `startCrossing` and each is read one tick after
// its own `reset`, so the game time, the score, the level, the timer and the five
// open bays are the same in all three and `lives` is the only thing that differs
// between them. That is what makes a difference in the bar attributable to the
// lives readout rather than to anything the build animates there: a difference
// cannot be the clock, because the clock reads the same in all three — and
// `reset` seeds the randomness (specs/instrumentation.md), so it cannot be a
// build's randomly placed ornament either.
//
// ONLY THE HUD BAR IS READ, over `y` in `[0, HUD_H]` (specs/strait.md), so
// nothing the build draws on the strait — where specs/ui.md puts no readout — can
// supply the difference.
//
// AND THE FIGURE ITSELF IS READ, because the review item states one: "a fresh run
// reads three and it reads two after the first death". A readout drawn
// differently for each count is not yet a readout that COUNTS — a build showing
// the lives IN RESERVE draws `2` on a fresh run and `1` after the first death,
// and a build drawing an arbitrary ornament per count draws neither, and the
// difference reading above credits both. So a second reading is taken over a run
// that has genuinely lost a life, and the bar is required to SHOW the figure.
//
// EITHER PRESENTATION SATISFIES IT, because specs/ui.md leaves the arrangement
// and styling to the build and specs/assets.md says "a lives icon in the HUD may
// reuse one of these frames": the figure is shown either by a run of text inside
// the bar carrying it as a number, or by exactly that many draws of
// `assets/crosser/` inside the bar. A build that draws three little critters up
// there has shown the lives as plainly as one that draws a `3`. Nothing else the
// bar can carry reads as `3` or `2`: specs/progression.md opens a run with a score
// of `0` at level `1` of `8` on a `30`-second crossing timer.
//
// THE DEATH IS A REAL ONE — the critter is posed onto an uncovered water tile,
// which specs/water.md makes a drowning, and the reading waits for the run to come
// back to a live crossing on its own. `setLives(2)` would have decided the same
// figure without deciding that the game counts it.
//
// WHAT THIS POINT DOES NOT DECIDE. That a fresh run HAS three lives, and that a
// death takes one, are `progression`'s: `progression/three-lives` and the death
// items. This point reads what the bar draws for the count the run holds.

import { afterEach, beforeEach, it } from "vitest";
import { HUD_H, STAGE_W, START_LIVES } from "../../src/constants";
import { assertEqual, assertGreaterThanOrEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startCrossing,
  ticksFor,
  type Harness,
} from "../harness";
import { renderFrame } from "./frame";
import { hudNumbers, hudRuns } from "./hud";
import { differingPixels, readRaster, unitArea, type Raster } from "./raster";
import { spritesOf } from "./sprites";

/**
 * How far apart two pixels must be to count as drawn differently, as an RGB
 * distance out of about `441`.
 *
 * Two renderings of the SAME readout are identical to the byte — the two frames
 * are posed alike and read at the same tick — so this bound is not separating
 * signal from noise; it is there so that a build whose readout shifts by a shade
 * a player could never see is not credited with having drawn a different count.
 * Thirty is a fifteenth of the range, well under the contrast any readout must
 * already have against the bar behind it.
 */
const PIXEL_DISTANCE_MIN = 30;

/**
 * How much of the HUD bar must be drawn differently, in square stage units.
 *
 * Twelve — about a `3 x 4` patch of a stage `1280 x 720` units across, inside a
 * bar `80` units tall that carries five readouts. A readout a player can actually
 * count differs by a multiple of that between two counts, even set small: the
 * digit of a readout set at the smallest size anyone would call legible here
 * changes by more, and a row of marks by far more. A readout that ignored the
 * count differs in none of it. It is a floor on "drawn differently at all", not a
 * measure of how the difference should look.
 */
const CHANGED_MIN_UNITS = 12;

/** The counts read: the three a run passes through, most to fewest. */
const COUNTS: readonly number[] = [
  START_LIVES,
  START_LIVES - 1,
  START_LIVES - 2,
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** A fresh crossing with `lives` posed, and the HUD bar it drew one tick later. */
async function barAt(lives: number): Promise<Raster> {
  startCrossing(h);
  h.debug.setLives(lives);
  await renderFrame(h);
  // The situation: the run really holds the count the readout is being read
  // against, still, on the tick the bar below is read from.
  assertEqual(
    h.snapshot().lives,
    lives,
    "the posed lives, read back (specs/instrumentation.md)",
  );
  return readRaster(h, 0, 0, STAGE_W, HUD_H);
}

it("draws the HUD's lives readout differently for each count a run passes through", async () => {
  const bars: { count: number; bar: Raster }[] = [];
  for (const count of COUNTS) bars.push({ count, bar: await barAt(count) });
  // Before the assertions, so a failing verdict still leaves the last bar.
  captureStill(h, "hud");

  const minChanged = CHANGED_MIN_UNITS * unitArea(bars[0].bar);
  for (let i = 0; i < bars.length; i += 1) {
    for (let j = i + 1; j < bars.length; j += 1) {
      const changed = differingPixels(
        bars[i].bar,
        bars[j].bar,
        PIXEL_DISTANCE_MIN,
      );
      assertGreaterThanOrEqual(
        changed.length,
        minChanged,
        `the device pixels of the HUD bar drawn differently at ` +
          `${bars[i].count} lives and at ${bars[j].count} — the lives readout ` +
          `counts the run's lives (specs/ui.md), and 'lives' is the only ` +
          `thing that differs between the two frames`,
      );
    }
  }
});

/**
 * Where the critter is put to drown: open water, well inside the strait.
 *
 * `WATER_TOP + 4` is a middle row of the water band, and column `20` is the
 * column a crossing begins on, so a floe drifting past cannot be under it at the
 * instant it is posed — and if one arrives, the wait below simply ends on the
 * death that follows.
 */
const DROWN_COL = 20;
const DROWN_ROW = 6;

/**
 * How long the run is given to come back to a live crossing after the drowning.
 *
 * Three seconds. specs/progression.md holds a death for `DEATH_PAUSE` (`0.9` s)
 * before the respawn, so this is a ceiling on a build that never comes back
 * rather than a figure this point asserts — `progression/death-pause` is what
 * decides the length of the hold.
 */
const RESPAWN_DEADLINE_FRAMES = ticksFor(3);

/** How a frame showed a count: as a figure in the bar, and as critter icons in it. */
interface Shown {
  /** A run of text inside the bar carries the count as one of its numbers. */
  digits: boolean;
  /** Draws of `assets/crosser/` whose box lies inside the bar. */
  icons: number;
  /** What the bar's runs of text actually said, for the failure message. */
  drew: string;
}

/** Read the frame `h.calls` holds for the count it shows. */
async function shown(h: Harness, lives: number): Promise<Shown> {
  const sprites = await spritesOf(h, h.calls);
  return {
    digits: hudNumbers(h).includes(lives),
    // Draws of the critter's own art inside the bar: the icon presentation
    // specs/assets.md allows. Nothing of the strait is drawn up here
    // (specs/ui.md), which is `strait/hud-above-strait`'s own point.
    icons: sprites.filter(
      (sprite) =>
        sprite.y - sprite.h / 2 >= 0 &&
        sprite.y - sprite.h / 2 <= HUD_H &&
        sprite.matches.some((match) => match.folder === "crosser"),
    ).length,
    drew: hudRuns(h)
      .map((run) => JSON.stringify(run.text))
      .join(", "),
  };
}

it("draws three lives on a fresh crossing and two after the first death", async () => {
  startCrossing(h);
  await renderFrame(h);
  const opening = await shown(h, START_LIVES);
  const fresh = h.snapshot();

  // A real death: an uncovered water tile is a drowning (specs/water.md).
  h.debug.setCritterTile(DROWN_COL, DROWN_ROW);
  const back = await h.until(
    (snapshot) =>
      snapshot.lives === START_LIVES - 1 && snapshot.phase === "crossing",
    { maxFrames: RESPAWN_DEADLINE_FRAMES },
  );
  await renderFrame(h);
  const after = await shown(h, START_LIVES - 1);
  captureStill(h, "hud");

  // The situation: the run really held three lives, and a death really took one.
  assertEqual(
    fresh.lives,
    START_LIVES,
    `a fresh crossing holding START_LIVES (${START_LIVES}) lives ` +
      `(specs/progression.md)`,
  );
  assertTrue(
    back.hit,
    `the drowning to cost a life and the crossing to resume within three ` +
      `seconds (specs/progression.md) — the run reported ` +
      `${back.snapshot.lives} lives in phase ${back.snapshot.phase}`,
  );

  assertTrue(
    opening.digits || opening.icons === START_LIVES,
    `the HUD bar showing START_LIVES (${START_LIVES}) on a fresh crossing — ` +
      `as a run of text inside the bar carrying ${START_LIVES}, or as ` +
      `${START_LIVES} draws of assets/crosser/ inside it (specs/ui.md, ` +
      `specs/assets.md); the bar drew ${opening.drew} and ${opening.icons} ` +
      `critter icons`,
  );
  assertTrue(
    after.digits || after.icons === START_LIVES - 1,
    `the HUD bar showing ${START_LIVES - 1} after the first death, which is ` +
      `the lives counting the critter currently crossing (specs/ui.md) — a ` +
      `build showing the lives in reserve draws ${START_LIVES - 2} here; the ` +
      `bar drew ${after.drew} and ${after.icons} critter icons`,
  );
});
