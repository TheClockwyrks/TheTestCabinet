// controls/setmaze-houses-predators — a posed layout sets the layout and nothing
// else.
//
// specs/instrumentation.md is explicit about the whole of what `setMaze` does:
// "The layout is the whole of what it sets. The plankton, the revealed-tile
// memory, the roster, every body's tile and facing, the cooldowns, the score, the
// lives, the depth and the screen are all left exactly as they stand, so a caller
// poses each of those itself." And "After the call the game behaves in every
// respect as though the posed layout were the maze it had laid out itself."
//
// WHY THIS IS ITS OWN POINT. Almost every other point in this suite poses a
// fixture and then arranges a world on top of it, and each of those arrangements
// is only as good as this contract. A build that treated a posed layout as a
// fresh maze — refilling the plankton, rebuilding the roster, moving the forager
// to a start tile of its own choosing, dropping the score — would leave every one
// of those scenarios standing on something other than what its check asked for.
// One run went that way: hunters landed wherever the build's own den used to sit,
// which was the middle of a posed corridor, and three unrelated points reported an
// input bug and a turning bug against a build whose input and turning were fine.
// This is the point that fails for it.
//
// THE BOARD IS POSED DISTINCTIVE FIRST. A score of `0`, three lives, a maze full
// of plankton, no drifters and a roster in the den are what a build that rebuilt
// everything would land on by accident, so every reading the sentence names is
// moved off its opening value before the layout is posed: the score and the lives
// are set to figures nothing else produces, both cooldowns are left part-spent,
// the plankton are cleared down to a single posed pellet, one bonus drifter is put
// on the board, and one hunter is stood out on the corridor while the rest of the
// roster waits in the den. Every reading below is then a fact about what `setMaze`
// left rather than a coincidence.
//
// NOTHING IS ADVANCED ACROSS THE POSE. The claim is about the state the call
// leaves, and a tick of simulation would fold the game's own systems into the
// reading — a released hunter setting off, a cooldown running down. The two
// snapshots are taken either side of one operation and nothing else.
//
// THE ROSTER IS THE HARDEST HALF, which is why the fixture keeps several hunters
// standing at once. `specs/state.md` lists them in release order with one stable
// index each, and this point reads that whole list back: the kinds in order, the
// tile each one holds, its facing, its state and its release flag.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  fail,
} from "../assert";
import { spawnDrifter, stampLayout } from "../fixtures";
import { corridorTiles, isCorridor, type Tile } from "../maze";
import {
  captureReplay,
  createHarness,
  type FathomSnapshot,
  type Harness,
  startPlaying,
} from "../harness";

/**
 * The layout posed over the build's own board: a plain corridor and nothing else,
 * stamped from the tile the pellet stands on.
 *
 * What it holds does not matter. What matters is that it is a different board
 * from the one the game laid out, so a build that ignored the call or rebuilt the
 * world around it reads differently from one that simply set the layout.
 */
const BOARD = ["S......"];

/**
 * Ticks recorded after the reading is taken, so the clip shows the posed board
 * standing rather than one frozen frame.
 *
 * Half a second. Nothing this point asserts is read from these ticks: every
 * reading is taken either side of the one call, before they run.
 */
const SETTLE_TICKS = 60;

/** A score no opening dive is on, so "unchanged" is a reading rather than a zero. */
const POSED_SCORE = 370;

/** Lives no opening dive is on, for the same reason. */
const POSED_LIVES = 1;

/** Cooldowns left part-spent, so a build that reset them is caught. */
const POSED_SONAR_COOLDOWN = 1.5;
const POSED_INK_COOLDOWN = 2.5;

/** Everything about one predator this point holds `setMaze` to leaving alone. */
interface Hunter {
  kind: string;
  tx: number;
  ty: number;
  dir: string;
  state: string;
  released: boolean;
}

/** The roster as `specs/state.md` lists it, in release order. */
function roster(snapshot: FathomSnapshot): Hunter[] {
  return snapshot.predators.map((one) => ({
    kind: one.kind,
    tx: one.tx,
    ty: one.ty,
    dir: one.dir,
    state: one.state,
    released: one.released,
  }));
}

/** A corridor tile of the build's own board, for the loose hunter to stand on. */
function corridorTile(snapshot: FathomSnapshot): Tile {
  const tiles = corridorTiles(snapshot);
  if (tiles.length === 0) {
    fail(
      "corridor tiles on the board the dive laid out, for the hunter this " +
        "point poses out of the den; specs/maze.md gives a laid-out maze " +
        "corridor along every route it draws",
      "none",
    );
  }
  return tiles[0];
}

/**
 * The left tile of a side-by-side pair of corridor tiles with room along the row
 * for the layout this point poses.
 *
 * The pellet goes on that tile and the drifter on the one beside it, and the
 * posed layout is stamped from the same tile, so both stand on ground BOTH
 * layouts leave open. That matters because a pellet the new layout buries under
 * rock is a case `specs/instrumentation.md` leaves to the build — the sentence
 * this point reads is about what the call leaves alone, not about what a build
 * does with ground it can no longer reach.
 *
 * `specs/maze.md` leaves no dead end, so every corridor tile has at least two
 * open neighbours and a board that carries no such pair anywhere is one this
 * point fails on rather than one it declines to read.
 */
function posedRun(snapshot: FathomSnapshot): Tile {
  for (const tile of corridorTiles(snapshot)) {
    if (tile.tx + BOARD[0].length > snapshot.grid.cols) continue;
    if (isCorridor(snapshot, tile.tx + 1, tile.ty)) return tile;
  }
  fail(
    `two side-by-side corridor tiles on the board the dive laid out with the ` +
      `${BOARD[0].length} tiles of room the posed layout needs along their row`,
    "no such pair on the board",
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets the layout a posed board gives and leaves everything else as it stands", async () => {
  await startPlaying(h);

  const own = await h.snapshot();
  assertGreaterThan(
    own.predators.length,
    0,
    "predators on the roster the pose is held to leaving alone; " +
      "specs/predators.md puts one of each of the three kinds in the den at " +
      "depth 1",
  );

  // Every value the contract names, moved off the one an opening dive is on.
  await h.debug.setScore(POSED_SCORE);
  await h.debug.setLives(POSED_LIVES);
  await h.debug.setSonarCooldown(POSED_SONAR_COOLDOWN);
  await h.debug.setInkCooldown(POSED_INK_COOLDOWN);
  const loose = corridorTile(own);
  const pellet = posedRun(own);
  const drift: Tile = { tx: pellet.tx + 1, ty: pellet.ty };
  await h.debug.setPredatorTile(0, loose.tx, loose.ty);
  await h.debug.setPredatorDir(0, "left");
  await h.debug.setPredatorState(0, "wander");
  // The plankton down to one posed pellet, and one bonus drifter on the board.
  // The drifter is a prop: what is read of it is that it is still there, so it is
  // posed with its mind off and decides nothing (specs/instrumentation.md).
  await h.debug.clearPlankton();
  await h.debug.setPlankton(pellet.tx, pellet.ty, true);
  await spawnDrifter(h, drift, { mind: false });

  const before = await h.snapshot();
  // The pellet and the drifter really are on the board, so the two readings that
  // follow the call are of something rather than of an empty list.
  assertEqual(
    before.planktonRemaining,
    1,
    "the plankton left on the board after clearPlankton and one posed pellet",
  );
  assertEqual(
    before.drifters.length,
    1,
    "the bonus drifters on the board after one was spawned onto it",
  );
  // Stamped from the pellet's own tile, so the row the layout poses runs along
  // the pair the pellet and the drifter stand on.
  const stamped = stampLayout(before, BOARD, { at: pellet });
  const after = await captureReplay(h, "housed", async () => {
    await h.debug.setMaze(stamped.rows);
    // Read the instant the call leaves, before anything is advanced: the claim
    // is about the state the operation leaves, and a tick of simulation would
    // fold the game's own systems into it.
    const posed = await h.snapshot();
    // The clip runs on past the reading so the picture shows the posed board
    // standing rather than a single frozen frame. Nothing below is read from it.
    await h.advance(SETTLE_TICKS);
    return posed;
  });

  // The layout IS set, which is the one thing the operation does.
  assertDeepEqual(
    after.tiles,
    stamped.rows,
    "the layout the snapshot reports after the pose, against the rows it was " +
      "handed",
  );

  // And nothing else moved.
  assertDeepEqual(
    roster(after),
    roster(before),
    "the roster after the pose, in release order, against the roster before it " +
      "— specs/instrumentation.md leaves the roster and every body's tile and " +
      "facing exactly as they stand",
  );
  assertEqual(
    after.forager.tx,
    before.forager.tx,
    "the forager's column after the pose, which setMaze leaves as it stands",
  );
  assertEqual(
    after.forager.ty,
    before.forager.ty,
    "the forager's row after the pose, which setMaze leaves as it stands",
  );
  assertEqual(
    after.forager.dir,
    before.forager.dir,
    "the forager's facing after the pose, which setMaze leaves as it stands",
  );
  assertEqual(
    after.score,
    POSED_SCORE,
    "the score after the pose, which setMaze leaves as it stands",
  );
  assertEqual(
    after.lives,
    POSED_LIVES,
    "the lives after the pose, which setMaze leaves as it stands",
  );
  assertEqual(
    after.depth,
    before.depth,
    "the depth after the pose, which setMaze leaves as it stands",
  );
  assertEqual(
    after.screen,
    before.screen,
    "the screen after the pose, which setMaze leaves as it stands",
  );
  assertEqual(
    after.sonar.cooldown,
    before.sonar.cooldown,
    "the sonar cooldown after the pose, which setMaze leaves as it stands",
  );
  assertEqual(
    after.ink.cooldown,
    before.ink.cooldown,
    "the ink cooldown after the pose, which setMaze leaves as it stands",
  );
  assertEqual(
    after.planktonRemaining,
    before.planktonRemaining,
    "the plankton remaining after the pose, which setMaze leaves as it stands",
  );
  assertDeepEqual(
    after.plankton,
    before.plankton,
    "the plankton layer after the pose, which setMaze leaves as it stands",
  );
  assertEqual(
    after.drifters.length,
    before.drifters.length,
    "the bonus drifters on the board after the pose, which setMaze leaves as " +
      "they stand",
  );
  assertDeepEqual(
    after.visibility,
    before.visibility,
    "the revealed-tile memory after the pose, which setMaze leaves exactly as " +
      "it stands",
  );
});
