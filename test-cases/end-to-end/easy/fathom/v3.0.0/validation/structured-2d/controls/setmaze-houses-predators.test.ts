// controls/setmaze-houses-predators — a posed layout sets the layout and nothing
// else, and a body the new rock closes over holds its tile.
//
// specs/instrumentation.md fixes both halves. "The layout is the whole of what it
// sets. The plankton, the revealed-tile memory, the roster, every body's tile and
// facing, the cooldowns, the score, the lives, the depth and the screen are all
// left exactly as they stand, so a caller poses each of those itself." And: "A
// body the new layout leaves on a tile closed to it holds that tile and travels
// nowhere, because travel carries a body only along tiles open to it."
//
// WHY THIS IS ITS OWN POINT. Every other check in this suite poses a fixture and
// then puts back exactly the creatures its requirement is about, and every one of
// those poses is only as good as this contract. A build that quietly re-dens the
// roster, re-seeds the plankton or restarts the countdown when a layout is posed
// hands every one of them a board it did not ask for — a hunter in the middle of a
// corridor a check meant to be empty, a pellet under a forager a check meant to be
// standing on bare rock. One run went exactly that way: a Lanternjaw stood in the
// middle of a posed corridor, ate the forager a quarter of a second in, and three
// unrelated points reported an input bug and a turning bug against a build whose
// input and turning were fine. This is the point that fails for it.
//
// THE ROSTER IS THE SUBJECT, so this is one of the few checks that stands SEVERAL
// hunters up at once: three of them, on three known tiles, in three different
// conditions — one released and one not, one facing each way — because a build
// that resets one field of a predator and preserves the rest passes a check that
// reads only one.
//
// THEIR MINDS ARE OFF ACROSS THE CALL, so what is read straight after `setMaze` is
// what the call did rather than what a patrol did in the same tick. The last
// reading turns one back ON: the hunter the new layout walled in is left to run its
// own mind for a second of simulation, and holding its tile through that is the
// second half of the claim.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLessThanOrEqual } from "../assert";
import { poseMaze, spawnPredator, stampLayout } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { parkForager } from "../scene";
import type { Tile } from "../maze";

/**
 * The board the roster is stood up on: a room for the forager on the top row and,
 * across solid rock, a seven-tile corridor with the three hunters on `A`, `B` and
 * `C`.
 */
const BEFORE = ["F......", "", "A..B..C"] as const;

/**
 * The board posed over it. It is the same drawing with the three tiles around `B`
 * turned to rock, so the middle hunter is left standing on a tile the new layout
 * closed to it while the other two keep open corridor under them. Both arts are
 * the same size, so both stamp at the same place in the grid and every anchor
 * keeps its tile.
 */
const AFTER = ["F......", "", "A..###C"] as const;

/** The score the run is put on, which the call must leave alone. */
const POSED_SCORE = 4321;

/** The lives held in reserve, likewise. */
const POSED_LIVES = 2;

/** The depth, likewise. */
const POSED_DEPTH = 3;

/**
 * The two cooldowns, posed plainly mid-run so neither reads as a fresh maze's.
 *
 * `specs/instrumentation.md` names them among the things a posed layout leaves
 * exactly as they stand, and a maze laid out afresh carries both ready at `0`.
 * Each is read back to the tenth of a second the pose ran a tick or two before,
 * because both count down on the game's own clock.
 */
const POSED_SONAR_COOLDOWN = 3.5;
const POSED_INK_COOLDOWN = 2.25;

/** How far a cooldown read back may sit from the value posed, in seconds. */
const COOLDOWN_TOLERANCE = 0.1;

/**
 * How long the walled-in hunter is left to run its own mind, in ticks.
 *
 * A second, which is three tiles and more of travel at any speed
 * specs/predators.md fixes for a loose predator: a hunter that means to move has
 * moved long before this runs out.
 */
const WALLED_WATCH_TICKS = ticksFor(1);

/** One predator, as this point compares it either side of the call. */
interface Standing {
  kind: string;
  tx: number;
  ty: number;
  dir: string;
  state: string;
  released: boolean;
  mind: boolean;
  travel: boolean;
}

/** Every predator of a snapshot, in roster order, as the comparison reads them. */
function roster(snapshot: ReturnType<Harness["snapshot"]>): Standing[] {
  return snapshot.predators.map((one) => ({
    kind: one.kind,
    tx: one.tx,
    ty: one.ty,
    dir: one.dir,
    state: one.state,
    released: one.released,
    mind: one.mind,
    travel: one.travel,
  }));
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("poses a layout and leaves the roster and the run exactly as they stand", async () => {
  startPlaying(h);
  const board = await poseMaze(h, BEFORE);
  const home = board.mark("F");
  const posts: Tile[] = [board.mark("A"), board.mark("B"), board.mark("C")];
  await parkForager(h, home);

  // The rest of the run, each figure posed away from what a freshly laid-out maze
  // would carry, so every reading below is a question rather than a formality.
  // `setDepth` lays out the depth's own roster, so it runs BEFORE the three
  // hunters this point reads are stood up, and the roster it laid is cleared away
  // again.
  h.debug.setScore(POSED_SCORE);
  h.debug.setLives(POSED_LIVES);
  h.debug.setDepth(POSED_DEPTH);
  h.debug.setSonarCooldown(POSED_SONAR_COOLDOWN);
  h.debug.setInkCooldown(POSED_INK_COOLDOWN);
  h.debug.clearPredators();

  // Three hunters, each posed differently, and all of them held still so that what
  // is read after the call is the call's doing.
  const walled = 1;
  await spawnPredator(h, "lanternjaw", posts[0], {
    dir: "left",
    mind: false,
  });
  const unreleased = await spawnPredator(h, "gloamfin", posts[1], {
    dir: "right",
    mind: false,
  });
  h.debug.setPredatorReleased(unreleased, false);
  await spawnPredator(h, "flarefish", posts[2], {
    dir: "down",
    mind: false,
  });

  const kept = roster(h.snapshot());

  const pellet: Tile = { tx: posts[0].tx + 1, ty: posts[0].ty };
  h.debug.setPlankton(pellet.tx, pellet.ty, true);
  h.debug.spawnDrifter(home.tx, home.ty);
  h.debug.setDrifterMind(0, false);
  const before = h.snapshot();

  const read = await captureReplay(h, "housed", async () => {
    const rows = stampLayout(before, AFTER).rows;
    h.debug.setMaze(rows);
    const after = h.snapshot();

    // And the walled-in hunter, left to its own mind on a tile the layout closed
    // over.
    h.debug.setPredatorMind(walled, true);
    await h.advance(WALLED_WATCH_TICKS);
    return { after, ended: h.snapshot() };
  });

  // The layout really did change, which is what makes every reading below a
  // reading of a call that did something.
  assertEqual(
    read.after.tiles[posts[walled].ty][posts[walled].tx],
    "#",
    `the tile the middle hunter stands on, (${posts[walled].tx}, ` +
      `${posts[walled].ty}), which the posed layout draws as rock`,
  );

  // The roster: every predator, every field, exactly as it stood.
  assertDeepEqual(
    roster(read.after),
    kept,
    "the roster after a layout was posed over it, which setMaze leaves exactly " +
      "as it stands",
  );

  // The rest of the run.
  assertEqual(read.after.score, POSED_SCORE, "the score across setMaze");
  assertEqual(read.after.lives, POSED_LIVES, "the lives across setMaze");
  assertEqual(read.after.depth, POSED_DEPTH, "the depth across setMaze");
  assertEqual(
    read.after.screen,
    before.screen,
    "the screen across setMaze, which the call leaves exactly as it stands",
  );
  assertEqual(
    read.after.plankton[pellet.ty][pellet.tx],
    "*",
    `the plankton on (${pellet.tx}, ${pellet.ty}), a tile the new layout leaves ` +
      "open, which setMaze leaves exactly as it stands",
  );
  assertEqual(
    read.after.planktonRemaining,
    before.planktonRemaining,
    "planktonRemaining across setMaze, none of whose plankton the new layout " +
      "walled in",
  );
  assertEqual(
    read.after.drifters.length,
    before.drifters.length,
    "the bonus drifters in the maze across setMaze",
  );
  assertLessThanOrEqual(
    Math.abs(read.after.sonar.cooldown - before.sonar.cooldown),
    COOLDOWN_TOLERANCE,
    "how far the sonar cooldown moved across setMaze, which the call leaves " +
      "exactly as it stands",
  );
  assertLessThanOrEqual(
    Math.abs(read.after.ink.cooldown - before.ink.cooldown),
    COOLDOWN_TOLERANCE,
    "how far ink's cooldown moved across setMaze, which the call leaves " +
      "exactly as it stands",
  );
  assertEqual(
    read.after.forager.tx,
    before.forager.tx,
    "the forager's column across setMaze",
  );
  assertEqual(
    read.after.forager.ty,
    before.forager.ty,
    "the forager's row across setMaze",
  );
  assertEqual(
    read.after.forager.dir,
    before.forager.dir,
    "the forager's facing across setMaze",
  );

  // The second half: the hunter the new rock closed over travels nowhere.
  const held = read.ended.predators[walled];
  assertEqual(
    `${held.tx}, ${held.ty}`,
    `${posts[walled].tx}, ${posts[walled].ty}`,
    `the tile the ${held.kind} stands on after ${WALLED_WATCH_TICKS} ticks of ` +
      "running its own mind on a tile the posed layout closed to it",
  );
});
