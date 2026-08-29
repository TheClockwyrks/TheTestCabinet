// scoring/descend-on-clear — the cleared screen gives way to a fresh, deeper maze.
//
// specs/progression.md: "the next maze then begins at depth `d + 1`, opening on
// the dive countdown as the first maze of the dive does", and "The next maze
// starts fresh: plankton on every corridor tile outside the den, the fog fully
// unrevealed, the forager at rest on its start tile, every predator in the den
// with its `released` flag `false` ..., no bonus drifters, and the drifter cadence
// restarted. The score and the lives in reserve carry across." Every clause of
// that is read below off the maze the build laid out.
//
// THE DESCENT IS WAITED FOR, ON A HARD CEILING. How long the interstitial holds is
// the build's own within a window specs/ui.md fixes: "The cleared interstitial
// holds for at least `1 s` and at most `3 s` before the descent." So the sweep
// runs to that ceiling and no further — a build that holds the screen longer FAILS
// here rather than leaving the point undecided, and a build that descends after
// two seconds passes exactly as one that descends after one.
//
// THE FOG IS READ AGAINST THE LIGHT, NOT AGAINST NOTHING. specs/ui.md has the
// countdown advance "the light the forager casts on the maze around it", so by the
// time the descent is visible the forager's own pocket is legitimately lit. What
// "fully unrevealed" therefore means at this moment is that NOTHING BEYOND THAT
// POCKET has been touched: every tile the build reports as anything but `u` lies
// within the widest light radius specs/sensing.md allows, `VISION_MIN +
// VISION_GAIN` at `G = 1`. A build carrying the previous maze's fog across fails
// that on the far side of the board.
//
// THE MAZE IS EMPTIED AND ONE PELLET POSED BACK, exactly as
// `scoring/cleared-bonus` does and for the same reason: `clearPlankton` scores
// nothing and clears no maze (specs/instrumentation.md), so the bite that clears
// is the game's own.

import { afterEach, beforeEach } from "vitest";
import { VISION_GAIN, VISION_MIN } from "../../src/constants";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { placeForager, poseMaze } from "../fixtures";
import {
  captureReplay,
  centerOf,
  createHarness,
  DIR_KEY,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { check, denAll, requireSwim } from "../scene";
import type { FathomSnapshot } from "../surface";

/**
 * The board: five tiles of straight corridor, the forager on the first and the
 * maze's last remaining pellet on the last, which is a dead end.
 */
const ART = ["S...T"] as const;

/** How long the clearing bite may take under a held action, in ticks. */
const BITE_BUDGET = ticksFor(2);

/**
 * How long the cleared interstitial may hold before the descent, in ticks.
 *
 * specs/ui.md fixes the ceiling at `3 s`, timed "on the simulation's own
 * accumulated time rather than on the wall clock". A quarter of a second of slack
 * covers the tick the transition happens to land on.
 */
const DESCENT_BUDGET = ticksFor(3.25);

/**
 * Ticks between the descent and the reading, so a build that opens the countdown
 * at the top of the step after the depth changes is read as conforming.
 */
const SETTLE_TICKS = ticksFor(0.05);

/** Ticks past the reading, purely so the clip closes on the new maze. */
const TAIL_TICKS = ticksFor(0.75);

/**
 * The furthest the forager's own light can have reached, in logical units.
 *
 * specs/sensing.md: `V = VISION_MIN + VISION_GAIN * G` with `G` at most `1`. Every
 * other source of revelation is out of play here — no pulse is cast and every
 * predator is denned, so no flare burns.
 */
const LIGHT_MAX = VISION_MIN + VISION_GAIN;

/** How many corridor tiles a layout holds outside the den and its gate. */
function corridorTiles(snapshot: FathomSnapshot): number {
  return snapshot.tiles.reduce(
    (total, row) => total + [...row].filter((tile) => tile === ".").length,
    0,
  );
}

/** The furthest from the forager any tile the build reports as revealed lies. */
function farthestRevealed(snapshot: FathomSnapshot): number {
  let worst = 0;
  for (let ty = 0; ty < snapshot.visibility.length; ty += 1) {
    const row = snapshot.visibility[ty];
    for (let tx = 0; tx < row.length; tx += 1) {
      if (row[tx] === "u") continue;
      const at = centerOf(snapshot, { tx, ty });
      worst = Math.max(
        worst,
        Math.hypot(at.x - snapshot.forager.x, at.y - snapshot.forager.y),
      );
    }
  }
  return worst;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

check("Clearing descends to the next depth", async () => {
  startPlaying(h);
  const board = await poseMaze(h, ART);
  const start = board.mark("S");
  const target = board.mark("T");
  await placeForager(h, start, "right");
  h.debug.clearPlankton();
  h.debug.setPlankton(target.tx, target.ty, true);
  await denAll(h);

  const dive = await captureReplay(h, "descend", async () => {
    const before = h.snapshot();
    h.hold(DIR_KEY.right);
    const eaten = await h.until((s) => s.planktonRemaining < 1, {
      maxFrames: BITE_BUDGET,
      poll: 1,
    });
    h.release(DIR_KEY.right);
    const descended = await h.until((s) => s.depth > before.depth, {
      maxFrames: DESCENT_BUDGET,
      poll: 1,
    });
    await h.advance(SETTLE_TICKS);
    const next = h.snapshot();
    await h.advance(TAIL_TICKS);
    return {
      before,
      cleared: eaten.snapshot,
      ate: eaten.hit,
      arrived: descended.hit,
      next,
    };
  });

  if (!dive.ate) {
    requireSwim(
      dive.before.forager,
      dive.cleared.forager,
      "reach the maze's last plankton",
    );
  }
  assertEqual(
    dive.arrived,
    true,
    `the cleared screen gave way to the next maze inside the ` +
      `${DESCENT_BUDGET} ticks specs/ui.md allows the interstitial`,
  );

  assertEqual(
    dive.next.depth,
    dive.before.depth + 1,
    "the depth of the maze the cleared screen gave way to",
  );
  assertEqual(
    dive.next.screen,
    "countdown",
    "the screen the next maze opens on",
  );
  assertEqual(
    dive.next.planktonRemaining,
    corridorTiles(dive.next),
    "the plankton the next maze opens with, against its own corridor tiles " +
      "outside the den",
  );
  assertEqual(
    dive.next.drifters.length,
    0,
    "the bonus drifters in the next maze",
  );
  assertEqual(
    dive.next.predators.filter((p) => p.state === "den" && !p.released).length,
    dive.next.predators.length,
    "the predators of the next maze that are denned and unreleased, of the " +
      "whole roster",
  );
  assertEqual(
    dive.next.score,
    dive.cleared.score,
    "the score carried across the descent",
  );
  assertEqual(
    dive.next.lives,
    dive.before.lives,
    "the lives carried across the descent",
  );
  assertLessThanOrEqual(
    farthestRevealed(dive.next),
    LIGHT_MAX,
    "how far from the forager the next maze reports a tile as anything but " +
      "unrevealed, against the widest the forager's own light reaches",
  );
});
