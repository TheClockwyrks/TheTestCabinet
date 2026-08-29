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
// THE BOARD IS POSED DISTINCTIVE FIRST. A score of `0`, three lives and a roster
// in the den are what a build that rebuilt everything would land on by accident,
// so each of those is moved off its opening value before the layout is posed: the
// score and the lives are set to figures nothing else produces, both cooldowns are
// left part-spent, and one hunter is stood out on the corridor while the rest of
// the roster waits in the den. Every reading below is then a fact about what
// `setMaze` left rather than a coincidence.
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
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { stampLayout } from "../fixtures";
import {
  captureReplay,
  createHarness,
  type FathomSnapshot,
  type Harness,
  startPlaying,
} from "../harness";

/**
 * The layout posed over the build's own board: a plain corridor and nothing else.
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
function corridorTile(snapshot: FathomSnapshot): { tx: number; ty: number } {
  for (let ty = 0; ty < snapshot.grid.rows; ty += 1) {
    const row = snapshot.tiles[ty] ?? "";
    for (let tx = 0; tx < snapshot.grid.cols; tx += 1) {
      if (row[tx] === ".") return { tx, ty };
    }
  }
  return { tx: -1, ty: -1 };
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
  await h.debug.setPredatorTile(0, loose.tx, loose.ty);
  await h.debug.setPredatorDir(0, "left");
  await h.debug.setPredatorState(0, "wander");

  const before = await h.snapshot();
  const stamped = stampLayout(before, BOARD);
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
});
