// scoring/caught-costs-life — contact costs a life and sets the board up again.
//
// specs/gameplay.md fixes contact: "The forager is in contact with a predator
// whose center lies on the forager's own tile, whatever that predator's kind and
// whatever it is doing." specs/progression.md fixes what it costs — "While a life
// remains in reserve, `lives` falls by `1`, the maze is set up for another
// attempt, and `screen` becomes `"countdown"`" — and then lists the arrangement
// that attempt starts from, clause by clause. Every clause is read below.
//
// THE HUNTER IS POSED ONTO THE FORAGER, because that IS the condition the
// specification states. A chase across a corridor would test the hunter's
// pathfinding, which `gloamfin/*` and `maze-movement/*` own, and would leave this
// point failing for a hunter that never arrived. So no hunter here travels at
// all: the whole roster is held where it stands, and the one catch this point
// reads is the one it posed.
//
// THE BOARD IS THE BUILD'S OWN, not a posed fixture, and that is the point. The
// arrangement includes "the forager at rest on its start tile", and a start tile
// only means something on a maze the build laid out for itself: `setMaze` rests
// the forager "on the first corridor tile in reading order, ... a defined resting
// place rather than a meaningful one" (specs/instrumentation.md). So the forager's
// tile at the opening of the dive is taken as the start tile, and the forager is
// MOVED OFF IT before the catch, so the reading is a real question rather than a
// forager that never left.
//
// EVERY CLAUSE IS POSED AWAY FROM ITS RESET VALUE FIRST, where the surface can
// pose it: brightness to `1`, both cooldowns part-spent, a bonus drifter on the
// board. What cannot be posed is a sonar wavefront or an ink cloud — no operation
// creates either, and reaching for the keys that do would put the controls between
// this point and its subject — so those two clauses are read as confirmations
// rather than as discriminating ones.
//
// NO SCENE GUARD. The guard's first finding is a screen that changed under the
// measurement, which here is the subject.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  fail,
} from "../assert";
import { BRIGHT_HOLD, INK_COOLDOWN, SONAR_COOLDOWN } from "../constants";
import {
  captureReplay,
  centerOf,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { corridorDirs, corridorTiles, type Dir, type Tile } from "../maze";
import {} from "../scene";

/** One step each way, for moving the forager off the tile it opened on. */
const STEP: Readonly<Record<Dir, { dx: number; dy: number }>> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

/**
 * Ticks the forager stands off its start tile before the catch.
 *
 * Half a second, which is long enough that a build carrying the forager on under
 * its own heading has settled wherever it was going before the catch is posed.
 */
const AWAY_TICKS = ticksFor(0.5);

/**
 * How long the catch may take once the hunter stands on the forager's tile.
 *
 * The condition holds the moment the pose lands, so this is a HARD ceiling on the
 * step the build resolves contact in rather than a wait for anything to travel.
 */
const CATCH_BUDGET = ticksFor(1);

/**
 * Ticks between the catch and the reading.
 *
 * specs/progression.md fixes the arrangement the next attempt starts from without
 * fixing the step it lands on, so the reading is taken a beat later, well inside
 * the `1 s` the dive countdown holds for at the very least (specs/ui.md).
 */
const SETTLE_TICKS = ticksFor(0.1);

/** Ticks past the reading, purely so the clip shows the board coming back. */
const TAIL_TICKS = ticksFor(0.75);

/**
 * Hold every hunter of the roster where it stands, minds running.
 *
 * This point runs on the build's OWN board, so it cannot empty the roster the way
 * a posed fixture does — the arrangement it reads is the one a catch sets up, and
 * that arrangement is about the whole roster. What it can do is exercise none of
 * their bodies: every catch below is POSED onto the forager's own tile, and a
 * hunter whose travel is off still makes contact (`specs/instrumentation.md`), so
 * no hunter can take a life this point did not stage. Called again after each
 * catch, in case the attempt it set up handed the den fresh bodies.
 */
function holdRoster(h: Harness): void {
  const roster = h.snapshot().predators;
  for (let index = 0; index < roster.length; index += 1) {
    h.debug.setPredatorTravel(index, false);
  }
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Contact costs a life and sets the board up again", async () => {
  const opened = startPlaying(h);
  const startTile: Tile = { tx: opened.forager.tx, ty: opened.forager.ty };
  if (opened.predators.length === 0) {
    fail(
      "the roster to carry a predator for the forager to make contact with; " +
        "specs/predators.md gives depth 1 one of each kind",
      opened.predators.length,
    );
  }

  holdRoster(h);

  // Off the start tile, so the reading below is a real question rather than a
  // forager that never left. It is CARRIED off it rather than driven: what this
  // point reads is the arrangement a catch sets up, and whether a held action
  // moves the forager is the movement points' subject.
  const leaving = corridorDirs(opened, startTile.tx, startTile.ty)[0];
  if (leaving === undefined) {
    fail(
      `the forager's start tile (${startTile.tx}, ${startTile.ty}) to have a ` +
        "corridor neighbour, so it can be moved off the tile the reset must " +
        "bring it back to; specs/maze.md fixes one connected region of corridor",
      "no corridor neighbour",
    );
  }
  const step = STEP[leaving];
  h.debug.setForagerTile(startTile.tx + step.dx, startTile.ty + step.dy);
  await h.advance(AWAY_TICKS);

  // Every clause the surface can pose is posed away from the value the reset must
  // restore, so each reading below is a question rather than a formality.
  h.debug.setBrightness(1);
  h.debug.setBrightHold(BRIGHT_HOLD);
  h.debug.setSonarCooldown(SONAR_COOLDOWN);
  h.debug.setInkCooldown(INK_COOLDOWN);
  const board = h.snapshot();
  const reach = (tile: Tile): number => {
    const at = centerOf(board, tile);
    return Math.hypot(at.x - board.forager.x, at.y - board.forager.y);
  };
  const away = corridorTiles(board).reduce(
    (best, tile) => (reach(tile) > reach(best) ? tile : best),
    startTile,
  );
  // A prop: the reset has to take it off the board, and nothing here is about
  // where it drifts, so it is posed inert on the furthest tile there is.
  h.debug.spawnDrifter(away.tx, away.ty);
  h.debug.setDrifterMind(h.snapshot().drifters.length - 1, false);

  const caught = await captureReplay(h, "caught", async () => {
    const before = h.snapshot();
    h.debug.setPredatorTile(0, before.forager.tx, before.forager.ty);
    h.debug.setPredatorState(0, "chase");
    const contact = await h.until((s) => s.lives < before.lives, {
      maxFrames: CATCH_BUDGET,
      poll: 1,
    });
    await h.advance(SETTLE_TICKS);
    const after = h.snapshot();
    await h.advance(TAIL_TICKS);
    return { before, hit: contact.hit, after };
  });

  assertGreaterThan(
    caught.before.drifters.length,
    0,
    "the bonus drifters the board carried when the hunter arrived",
  );
  assertEqual(
    caught.hit,
    true,
    `a life was lost inside ${CATCH_BUDGET} ticks of a predator standing on ` +
      `the forager's own tile (${caught.before.forager.tx}, ` +
      `${caught.before.forager.ty})`,
  );

  assertEqual(
    caught.after.lives,
    caught.before.lives - 1,
    "the lives after contact",
  );
  assertEqual(
    caught.after.screen,
    "countdown",
    "the screen the next attempt opens on",
  );
  assertDeepEqual(
    { tx: caught.after.forager.tx, ty: caught.after.forager.ty },
    startTile,
    "the tile the forager is set up on for another attempt, against the one " +
      "the dive opened on",
  );
  assertEqual(
    caught.after.forager.moving,
    false,
    "the forager is at rest for the next attempt",
  );
  assertEqual(
    caught.after.brightness,
    0,
    "the forager's brightness for the next attempt, posed at 1 before the catch",
  );
  assertEqual(
    caught.after.predators.filter((p) => p.state === "den" && !p.released)
      .length,
    caught.after.predators.length,
    "the predators back in the den with released false, of the whole roster",
  );
  assertEqual(
    caught.after.drifters.length,
    0,
    "the bonus drifters left on the board",
  );
  assertEqual(caught.after.pulses.length, 0, "the sonar wavefronts in flight");
  assertEqual(caught.after.inkClouds.length, 0, "the ink clouds standing");
  assertEqual(caught.after.sonar.ready, true, "the sonar pulse is ready again");
  assertEqual(caught.after.ink.ready, true, "ink is ready again");
  assertEqual(
    caught.after.planktonRemaining,
    caught.before.planktonRemaining,
    "planktonRemaining across the catch, since the plankton already eaten stay " +
      "eaten",
  );
  assertEqual(
    caught.after.score,
    caught.before.score,
    "the score across the catch",
  );
  assertEqual(
    caught.after.depth,
    caught.before.depth,
    "the depth across the catch",
  );
});
