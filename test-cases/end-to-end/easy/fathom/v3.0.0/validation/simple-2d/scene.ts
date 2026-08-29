// Fathom — reading a posed scenario. CASE-PROVIDED.
//
// WHAT IS SHARED. This file is byte-identical in `validation/none/`,
// `validation/simple-2d/` and `validation/structured-2d/`. Like `fixtures.ts` it
// drives the game, and like `fixtures.ts` it drives it through a structural
// reading of the harness — {@link SceneHost} — rather than through any engine's
// own type, so the readings a check takes are one set of readings under all
// three. Every pure part of it lives in `maze.ts` instead.
//
// WHAT THIS IS FOR. `fixtures.ts` poses the world; this reads the run around it.
// Which hunter of a roster a check means, how far something stands from the
// forager, and whether the scenario the check arranged was still standing when
// the measurement ended.
//
// EVERY READING HERE ENDS IN A PASS OR A FAIL. Nothing in this suite declines,
// stands down, or leaves a point undecided: a run carries one score, and one
// number cannot separate a point lost to a failure from a point nothing could
// decide. The guarantee that makes that honest is not caught here but posed in
// `fixtures.ts`, which empties the board of everything a check is not about, so
// there is no bystander left to wander into a measurement and no containment
// left to give way. What survives here is the narrow question a check still owes
// an answer to: the world it arranged is the world it measured, and where it was
// not, this check failed.

import { fail } from "./assert";
import {
  faceWall,
  placeForager,
  type Awaitable,
  type FixtureBoard,
  type FixtureHost,
  type PredatorView,
} from "./fixtures";
import { type Dir, type Tile } from "./maze";

/* -------------------------------------------------------------------------- */
/* What a scenario reads                                                      */
/* -------------------------------------------------------------------------- */

/** The board and the run, as much of both as this module reads. */
export interface SceneView extends FixtureBoard {
  lives: number;
  planktonRemaining: number;
  brightness: number;
}

/** What a scenario helper needs of a harness. */
export interface SceneHost extends FixtureHost {
  snapshot(): Awaitable<SceneView>;
  advance(ticks: number): Awaitable<void>;
  /**
   * Run ticks that cost a captured section nothing, for setup rather than for
   * measurement. A harness whose recorder is bounded by the section a check
   * opens answers this with an ordinary advance.
   */
  skip(ticks: number): Awaitable<void>;
}

/* -------------------------------------------------------------------------- */
/* Reading the roster                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The index of the first predator of `kind`, or `-1` where the roster has none.
 *
 * For the handful of points that are about the ROSTER a depth gives — the
 * stagger, the re-release, the depth scaling — which read the hunters the game
 * laid out rather than spawning their own. Every other point spawns the one
 * hunter it is about onto an emptied roster and knows its index from that.
 */
export function indexOfKind(snapshot: SceneView, kind: string): number {
  return snapshot.predators.findIndex((one) => one.kind === kind);
}

/**
 * The roster index of the first predator of `kind`, or a FAILURE naming the
 * roster that does not carry it.
 *
 * For the points that read the roster a depth laid out rather than spawning
 * their own hunter. `specs/predators.md` puts one of each kind in the den at
 * depth `1`, so a roster missing one is a roster this point cannot be decided on
 * — and there is nowhere else for that to be decided, so it is decided here.
 */
export function requireKind(snapshot: SceneView, kind: string): number {
  const index = indexOfKind(snapshot, kind);
  if (index >= 0) return index;
  fail(
    `the roster to carry a ${kind}; specs/predators.md puts one of each of the ` +
      "three kinds in the den at depth 1",
    snapshot.predators.map((one) => one.kind).join(", ") || "an empty roster",
  );
}

/** The first predator of `kind`, or `undefined` where the roster has none. */
export function predatorOf(
  snapshot: SceneView,
  kind: string,
): PredatorView | undefined {
  return snapshot.predators.find((one) => one.kind === kind);
}

/**
 * How far `(x, y)` lies from the forager's center, in logical units.
 *
 * The one reading of "how far from the forager" in the suite. Every rule
 * `specs/sensing.md` and `specs/predators.md` state a range for — the light
 * radius, the Lanternjaw's and the Flarefish's reach, the Gloamfin's close
 * hearing, the kindle circle — is a straight-line distance between centers, so a
 * check that measured it any other way would be grading a different figure.
 */
export function fromForager(snapshot: SceneView, x: number, y: number): number {
  return Math.hypot(x - snapshot.forager.x, y - snapshot.forager.y);
}

/** How far the predator at roster `index` stands from the forager, in units. */
export function separation(snapshot: SceneView, index: number): number {
  const predator = snapshot.predators[index];
  return fromForager(snapshot, predator.x, predator.y);
}

/**
 * How far a body must travel before a scenario will believe it moved at all, in
 * logical units.
 *
 * An eighth of a tile: far below the tile-and-a-bit these scenarios actually
 * need, and far above the rounding of a single step.
 */
export const MOTION_EPS = 4;

/**
 * The scenario's SUBJECT is a hunter that was supposed to travel, and it FAILS
 * when it did not.
 *
 * For a check that poses a hunter and reads what it does next — cross an ink
 * cloud, round a corner, reach the tile a ping found, close on the forager. Every
 * predator in `specs/predators.md` moves under its own power at a speed that page
 * fixes, so a hunter that covers no ground at all across a whole measurement has
 * not exhibited the behavior being graded, and there is no reading to take from
 * it.
 *
 * Deliberately NOT for the points that are about a predator staying put — a
 * denned hunter, a bystander held by `setPredatorMind(index, false)`, a hunter
 * boxed in by rock — each of which travels zero legitimately.
 */
export function requirePredatorMotion(
  before: SceneView,
  after: SceneView,
  index: number,
  what: string,
): void {
  const from = before.predators[index];
  const to = after.predators[index];
  if (from === undefined || to === undefined) {
    fail(
      `the roster to still hold the hunter this scenario posed at index ${index}`,
      `${after.predators.length} predators on the roster`,
    );
  }
  const moved = Math.hypot(to.x - from.x, to.y - from.y);
  if (moved >= MOTION_EPS) return;
  fail(
    `the ${to.kind} to travel under its own power while the scenario waited for ` +
      `it to ${what}; specs/predators.md fixes a speed for every state it can be in`,
    `${moved.toFixed(1)} units moved`,
  );
}

/* -------------------------------------------------------------------------- */
/* Holding the forager still                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Hold the forager still on a tile, as a BYSTANDER, for a scenario that reads
 * something else.
 *
 * `specs/movement.md` has the forager travel while a movement action is held and
 * come to rest where it stands when none is, and `setForagerTile` leaves it at
 * rest there "as though no movement key were held". Both a build that rests and
 * a build that carries on along its current heading are conforming, and a check
 * must not silently require one, so what pins the forager here is its FACING: a
 * body at rest "takes the desired direction when the tile that way is open to
 * it, and stays at rest otherwise", so a forager faced into rock stays where it
 * was put however long the scenario runs. A tile with no walled side keeps its
 * facing, which is the best available and is what a resting build does anyway.
 *
 * Only for a scenario in which the forager's own facing does not matter; a check
 * that reads its heading poses that heading itself.
 */
export async function parkForager(
  h: SceneHost,
  tile?: Tile,
): Promise<Dir | null> {
  const snapshot = await h.snapshot();
  const at: Tile = tile ?? { tx: snapshot.forager.tx, ty: snapshot.forager.ty };
  await placeForager(h, at);
  return faceWall(h, at);
}

/* -------------------------------------------------------------------------- */
/* The scene guard                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The picture {@link sceneGuard} took, for {@link requireSceneHeld} to judge a
 * later snapshot against.
 */
export interface SceneGuard {
  foragerParked: boolean;
  forager: Tile;
  lives: number;
  screen: string;
}

/**
 * Take a picture of the scenario the moment its arrangement finished, so a check
 * can assert that it was still standing when the measurement ended.
 *
 * TAKE IT ONCE THE SCENARIO IS POSED, which is what the picture is of. A check
 * that re-poses part-way through takes a fresh one at that point. Pass
 * `foragerParked: false` for a scenario in which the forager is meant to travel.
 */
export async function sceneGuard(
  h: SceneHost,
  options: { foragerParked?: boolean } = {},
): Promise<SceneGuard> {
  const snapshot = await h.snapshot();
  return {
    foragerParked: options.foragerParked ?? true,
    forager: { tx: snapshot.forager.tx, ty: snapshot.forager.ty },
    lives: snapshot.lives,
    screen: snapshot.screen,
  };
}

/**
 * What gave way since {@link sceneGuard} took its picture, as a sentence, or
 * `null` when nothing did.
 *
 * Exported for a point that wants the sentence rather than the assertion.
 */
export function sceneHeld(
  snapshot: SceneView,
  guard: SceneGuard,
): string | null {
  if (snapshot.lives < guard.lives) {
    return "the forager lost a life mid-measurement, which resets the board";
  }
  if (snapshot.screen !== guard.screen) {
    return `the dive left ${guard.screen} for ${snapshot.screen} mid-measurement`;
  }
  if (guard.foragerParked) {
    const at = snapshot.forager;
    if (at.tx !== guard.forager.tx || at.ty !== guard.forager.ty) {
      return (
        "the forager did not stay where the scenario parked it — it was at " +
        `(${guard.forager.tx}, ${guard.forager.ty}) and ended at ` +
        `(${at.tx}, ${at.ty}), so what was measured is not the situation this ` +
        "point describes"
      );
    }
  }
  return null;
}

/** What a point asks of the scene it posed. */
export interface SceneDemand {
  /** How a failure names the scenario. `"the scenario"` by default. */
  what?: string;
}

/**
 * The scene held, or this check FAILS.
 *
 * The scenario a check poses holds only what its own requirement concerns, so
 * there is nobody else left to blame: a life lost, a screen left, or a parked
 * forager that travelled is this build failing to leave alone a world it was
 * handed. Called after the measurement, before the readings are judged.
 */
export function requireSceneHeld(
  snapshot: SceneView,
  guard: SceneGuard,
  demand: SceneDemand = {},
): void {
  const broke = sceneHeld(snapshot, guard);
  if (broke !== null)
    fail(`${demand.what ?? "the scenario"} held to the end`, broke);
}
