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
// point failing for a hunter that never arrived.
//
// THE BOARD IS THE BUILD'S OWN, not a posed fixture, and that is the point. The
// arrangement includes "the forager at rest on its start tile", and a start tile
// only means something on a maze the build laid out for itself: `setMaze` rests
// the forager "on the first corridor tile in reading order, ... a defined resting
// place rather than a meaningful one" (specs/instrumentation.md). So the forager's
// tile at the opening of the dive is taken as the start tile, and the forager is
// TRAVELLED OFF IT before the catch, so the reading is a real question rather than
// a forager that never moved.
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
import { BRIGHT_HOLD, INK_COOLDOWN, SONAR_COOLDOWN } from "../../src/constants";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  fail,
} from "../assert";
import { holdPredators, spawnDrifter } from "../fixtures";
import {
  captureReplay,
  centerOf,
  createHarness,
  DIR_KEY,
  poseBrightness,
  requireForagerMotion,
  startPlaying,
  ticks,
  type Harness,
} from "../harness";
import { corridorDirs, corridorTiles, type Tile } from "../maze";
import { fromForager } from "../scene";

/**
 * Ticks the forager travels away from its start tile before the catch.
 *
 * Half a second at `FORAGER_SPEED` (128 units per second, specs/movement.md) is
 * two tiles, so the forager is unambiguously off the tile it opened on and the
 * reset has somewhere to bring it back from.
 */
const AWAY_TICKS = ticks(0.5);

/**
 * How long the catch may take once the hunter stands on the forager's tile.
 *
 * The condition holds the moment the pose lands, so this is a HARD ceiling on the
 * step the build resolves contact in rather than a wait for anything to travel.
 */
const CATCH_BUDGET = ticks(1);

/**
 * Ticks between the catch and the reading.
 *
 * specs/progression.md fixes the arrangement the next attempt starts from without
 * fixing the step it lands on, so the reading is taken a beat later, well inside
 * the `1 s` the dive countdown holds for at the very least (specs/ui.md).
 */
const SETTLE_TICKS = ticks(0.1);

/** Ticks past the reading, purely so the clip shows the board coming back. */
const TAIL_TICKS = ticks(0.75);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("Contact costs a life and sets the board up again", async () => {
  const opened = await startPlaying(h);
  const startTile: Tile = {
    tx: opened.forager.tx,
    ty: opened.forager.ty,
  };
  assertGreaterThan(
    opened.predators.length,
    0,
    "predators the dive opened with, one of which is posed onto the forager to " +
      "make the contact this point prices",
  );

  // Off the start tile, under the game's own movement code.
  const leaving = corridorDirs(opened, startTile.tx, startTile.ty)[0];
  if (leaving === undefined) {
    fail(
      `a corridor neighbour of the forager's start tile (${startTile.tx}, ` +
        `${startTile.ty}) to travel to, so the forager can be moved off the ` +
        "tile the reset must bring it back to",
      "the start tile has no open neighbour at all",
    );
  }
  const parked = h.snapshot();
  h.hold(DIR_KEY[leaving]);
  await h.advance(AWAY_TICKS);
  h.release(DIR_KEY[leaving]);
  requireForagerMotion(
    parked,
    h.snapshot(),
    "leave the start tile the reset has to bring it back to",
  );

  // Every clause the surface can pose is posed away from the value the reset
  // must restore, so each reading below is a question rather than a formality.
  await poseBrightness(h, 1, BRIGHT_HOLD);
  h.debug.setSonarCooldown(SONAR_COOLDOWN);
  h.debug.setInkCooldown(INK_COOLDOWN);
  const board = h.snapshot();
  const away = corridorTiles(board).reduce((best, tile) => {
    const at = centerOf(board, tile);
    const to = centerOf(board, best);
    const reach = (p: { x: number; y: number }): number =>
      fromForager(board, p.x, p.y);
    return reach(at) > reach(to) ? tile : best;
  }, startTile);
  await spawnDrifter(h, away, { mind: false });

  const caught = await captureReplay(h, "caught", async () => {
    const before = h.snapshot();
    // The whole roster held: what this point prices is the CONTACT rule and the
    // board the game lays out after it, and a second hunter crossing the maze
    // meanwhile is a bystander that could take the same life.
    await holdPredators(h);
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
    "planktonRemaining across the catch, since the plankton already eaten " +
      "stay eaten",
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
