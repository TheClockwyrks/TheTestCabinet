// maze — the boards the eight structural points are decided on.
//
// WHY THIS MODULE EXISTS. The `maze` category is the one place in this suite that
// does NOT pose a fixture. Every other point stamps the geometry it is about
// through `setMaze`, because finding that geometry in whatever board a build
// invented is a lottery. Here the board a build invented IS the subject: the
// eight points ask whether the layouts the game lays out for itself satisfy the
// rules specs/maze.md states of "a conforming maze". So each of them reads
// `snapshot().tiles` straight, and all eight share the same three chores, which
// live here rather than eight times over.
//
// SEVERAL LAYOUTS, NOT ONE. specs/instrumentation.md seeds every draw the game
// makes — "for the maze it lays out" among them — from the generator `reset`
// seeds, so a different seed is a different maze and the same seed is the same
// maze every time. A generator that conforms only sometimes is exactly the
// failure mode a single reading misses, so each point measures {@link SEEDS}
// layouts and asserts its rule of each one, naming the seed that broke it.
//
// THE STILL IS THE OFFENDING BOARD. Each of the eight declares one `image`
// output, and evidence of a rule broken on the fifth layout is a picture of the
// fifth layout. So a point measures every board first, hands {@link witness} its
// readings, and captures the one that offends — or the first, when none does —
// BEFORE it asserts anything, so a failing point still leaves the picture that
// shows why.
//
// AND IT IS SURVEYED FIRST. The trench is dark and a maze is drawn only where the
// fog has lifted (specs/sensing.md), so a picture taken wherever the forager
// happened to spawn shows a reviewer one corridor and a wall of black — no use at
// all as evidence about a LAYOUT. So {@link captureBoard} moves the forager to a
// handful of vantage points spread across the grid and casts a sonar pulse from
// each, which floods the corridors around it out to `E` tiles and leaves every
// tile the front reached remembered, and remembered tiles stay drawn. It then
// stands the forager where the point wants it — on its own start tile, or on the
// corridor outside the den gate for the two points about the chamber — and turns
// its brightness up to `1`, which specs/instrumentation.md widens the light
// pocket to its full `V` for.
//
// NONE OF THAT CAN REACH A VERDICT. Every reading a point asserts on is already
// taken by the time the survey starts, and the survey runs on a board reset to
// this seed rather than on the boards that were measured. A build that ignores
// the pulse loses a wider picture; it does not lose a point.

import {
  BINDINGS,
  SONAR_RANGE_BASE,
  SONAR_WAVE_SPEED,
  TICK_HZ,
} from "../../src/constants";
import { captureStill, startPlaying, type Harness } from "../harness";
import {
  corridorTiles,
  denTiles,
  gateTiles,
  tileAt,
  type BoardView,
  type Dir,
  type Tile,
} from "../maze";
import { denAll, standDown } from "../scene";
import type { FathomSnapshot } from "../surface";

/**
 * The seeds the eight structural points measure a layout at.
 *
 * Eight of them. specs/maze.md states its rules of every maze the game lays out,
 * so the honest reading is many boards rather than one, and eight is enough that
 * a generator conforming half the time is caught with near certainty while the
 * whole category still runs in a moment.
 */
export const SEEDS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8];

/** One freshly laid-out maze, and the seed the game laid it out from. */
export interface Board {
  readonly seed: number;
  readonly snapshot: FathomSnapshot;
}

/** One board's reading of a rule, and whether that reading keeps it. */
export interface Measured {
  readonly board: Board;
  readonly ok: boolean;
}

/**
 * Lay out one fresh maze per seed and hand back what the game reported of each.
 *
 * Read with no frame advanced, so what is measured is the layout as the game
 * opened the dive on it: nothing has moved, nothing has been eaten, and no
 * predator has left the den, so there is no window in which a bystander could
 * disturb a reading. That is why the points in this category carry no
 * `sceneGuard`, which every point that runs the simulation does.
 */
export function freshBoards(h: Harness): Board[] {
  const boards: Board[] = [];
  for (const seed of SEEDS) {
    boards.push({ seed, snapshot: startPlaying(h, seed) });
  }
  return boards;
}

/**
 * The board a point shows the reviewer: the first that broke its rule, or the
 * first of all when none did.
 */
export function witness<M extends Measured>(measured: readonly M[]): M {
  const offending = measured.find((one) => !one.ok);
  return offending ?? measured[0];
}

/**
 * Refuse to grade a point whose layout carries no corridor tile at all.
 *
 * Through `scene.ts`'s {@link standDown}, so this reads as a FAILURE naming the
 * point that owes the verdict rather than as a check that decided nothing. A suite
 * here holds one check, so a stand-down expressed as a skip would be reported as a
 * validator that never ran and hand the point to a reviewer.
 *
 * WHY THIS DEFERS. Four of these points count something that must come to zero —
 * `2 x 2` blocks, mirror mismatches, dead ends, unreachable corridor — and every
 * one of those counts is zero on a board of solid rock. A build that laid out no
 * maze would collect four passes it did not earn.
 *
 * The two points that OWN the emptiness never call this: `maze/proportions`
 * measures a density of `0` against a floor of `0.40`, and `maze/den-reachable`
 * finds no chamber for a predator to leave. Both fail, so a build that laid out
 * nothing is graded rather than excused.
 *
 * Whether a build lays out a maze that fills the grid is `maze/proportions`'
 * verdict to give: specs/maze.md bounds density at `MAZE_DENSITY_MIN` (`0.40`) of
 * the cells inside the border, and a board with no corridor reads `0`.
 */
export function requireLaidOut(boards: readonly Board[]): void {
  const bare = boards.find((one) => corridorTiles(one.snapshot).length === 0);
  if (bare === undefined) return;
  standDown(
    `the maze seed ${bare.seed} laid out carries no corridor tile at all, so ` +
      "there is no layout here to measure — whether the game lays one out that " +
      "fills the grid is maze/proportions' verdict, and it does give it",
  );
}

/**
 * Refuse to grade a point whose layout marks no den-interior tile.
 *
 * WHY THIS DEFERS. specs/maze.md has the chamber "made of den-interior tiles",
 * and both points that ask about the chamber — that it is enclosed, and that its
 * one gate sits on its top edge — have nothing to decide without one. Whether the
 * chamber is there at all is `maze/den-reachable`'s verdict, which asks for the
 * den a released predator comes out of and fails when there is none.
 */
export function requireDenChamber(boards: readonly Board[]): void {
  const bare = boards.find((one) => denTiles(one.snapshot).length === 0);
  if (bare === undefined) return;
  standDown(
    `the maze seed ${bare.seed} laid out marks no den-interior tile, so there ` +
      "is no chamber here to ask about — whether the layout carries the den a " +
      "released predator comes out of is maze/den-reachable's verdict",
  );
}

/** How the still is framed: on the forager where it spawned, or on the den. */
export type Framing = "board" | "den";

/** The key specs/movement.md binds the `a` action, "Emits a sonar pulse", to. */
const SONAR_KEY = BINDINGS.a[0];

/**
 * Frames a pulse is given to finish.
 *
 * specs/sensing.md has the front stand `SONAR_WAVE_SPEED` (`14`) corridor steps
 * per second and reach `SONAR_RANGE_BASE` (`9`) tiles at depth `1`, so it is
 * spent in under three-quarters of a second; this is a quarter of a second past
 * that, which also outlasts the `SONAR_COOLDOWN` this survey does not wait on (it
 * poses the cooldown to `0` before each cast instead).
 */
const PULSE_TICKS =
  Math.ceil((SONAR_RANGE_BASE / SONAR_WAVE_SPEED) * TICK_HZ) + TICK_HZ / 4;

/**
 * Where the survey casts from, as fractions of the grid's width and height.
 *
 * Six vantage points on a `3 x 2` lattice, each pulled onto the nearest corridor
 * tile. Six discs of `SONAR_RANGE_BASE` (`9`) tiles laid over a `36 x 18` grid
 * cover most of it, which is what turns the still into a picture of the layout a
 * reviewer can read the point off.
 */
const VANTAGES: readonly { fx: number; fy: number }[] = [
  { fx: 1 / 6, fy: 1 / 4 },
  { fx: 3 / 6, fy: 1 / 4 },
  { fx: 5 / 6, fy: 1 / 4 },
  { fx: 1 / 6, fy: 3 / 4 },
  { fx: 3 / 6, fy: 3 / 4 },
  { fx: 5 / 6, fy: 3 / 4 },
];

/**
 * Frames run after the forager is stood where the point wants it, so the build
 * has drawn the board with the light in its final place.
 *
 * Two, which is one more than a redraw needs: the light is turned up before them,
 * and a build is entitled to widen its pocket on the step after the value changes
 * rather than during it.
 */
const SETTLE_TICKS = 2;

/** The output id every point in this category declares for its still. */
const OUTPUT = "board";

/** The four ways to stand beside a tile, and the heading that faces it. */
const APPROACHES: readonly { dx: number; dy: number; facing: Dir }[] = [
  { dx: 0, dy: -1, facing: "down" },
  { dx: -1, dy: 0, facing: "right" },
  { dx: 1, dy: 0, facing: "left" },
  { dx: 0, dy: 1, facing: "up" },
];

/** The corridor tile of `view` nearest to a point on the grid, or `null`. */
function nearestCorridor(view: BoardView, fx: number, fy: number): Tile | null {
  const at = { tx: fx * (view.grid.cols - 1), ty: fy * (view.grid.rows - 1) };
  let best: Tile | null = null;
  let bestGap = Infinity;
  for (const tile of corridorTiles(view)) {
    const gap = (tile.tx - at.tx) ** 2 + (tile.ty - at.ty) ** 2;
    if (gap < bestGap) {
      bestGap = gap;
      best = tile;
    }
  }
  return best;
}

/**
 * A corridor tile beside a den gate and the heading that faces the gate from it,
 * or `null` where the layout has no gate with corridor beside it.
 *
 * Tried above the gate first, which is where specs/maze.md puts the corridor
 * outside a gate "on its top edge".
 */
function gateApproach(view: BoardView): (Tile & { facing: Dir }) | null {
  for (const gate of gateTiles(view)) {
    for (const { dx, dy, facing } of APPROACHES) {
      const tx = gate.tx + dx;
      const ty = gate.ty + dy;
      if (tileAt(view, tx, ty) === ".") return { tx, ty, facing };
    }
  }
  return null;
}

/**
 * Lay the board out again and keep a lit picture of it as the point's `board`
 * output.
 *
 * The same seed lays out the same maze (specs/instrumentation.md), so what is
 * pictured is the board that was measured. Every predator is put away first, so
 * no hunter that wandered into the frame reads as part of the layout.
 *
 * Nothing here can change a verdict: it runs after every reading a point takes,
 * it is a no-op outside a run, and a still that cannot be written is reported as
 * an output that never turned up.
 */
export async function captureBoard(
  h: Harness,
  board: Board,
  framing: Framing = "board",
): Promise<void> {
  try {
    startPlaying(h, board.seed);
    await denAll(h);
    const view = h.snapshot();
    const home = { tx: view.forager.tx, ty: view.forager.ty };

    // The survey: one pulse from each vantage point, each given time to finish.
    for (const { fx, fy } of VANTAGES) {
      const from = nearestCorridor(view, fx, fy);
      if (from === null) continue;
      h.debug.setForagerTile(from.tx, from.ty);
      h.debug.setSonarCooldown(0);
      await h.tap(SONAR_KEY);
      await h.advance(PULSE_TICKS);
    }

    // And the framing: where the point wants the light standing.
    const outside = framing === "den" ? gateApproach(view) : null;
    if (outside === null) {
      h.debug.setForagerTile(home.tx, home.ty);
    } else {
      h.debug.setForagerTile(outside.tx, outside.ty);
      h.debug.setForagerDir(outside.facing);
    }
    h.debug.setBrightness(1);
    await h.advance(SETTLE_TICKS);
  } catch (error) {
    // NOTHING ABOUT THE PICTURE MAY REACH A VERDICT. The survey drives real
    // operations, and a build that refuses one of them — a `setForagerTile` onto
    // a tile its own snapshot called corridor, a pulse it will not cast — would
    // otherwise turn a decided point into a setup error. Every reading this point
    // asserts on was taken before this ran, so the honest cost of a refusal is a
    // narrower picture.
    console.warn(
      `fathom: could not survey the board for its still: ${String(error)}`,
    );
  }
  captureStill(h, OUTPUT);
}
