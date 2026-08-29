// Fathom — the scenario oracle. CASE-PROVIDED, and byte-identical in every
// engine directory.
//
// A validator poses a situation, runs the real simulation for a bounded span,
// and reads one result. This module is what keeps the middle of that honest: the
// helpers that hold a scenario still, the ones that ask whether it held, and the
// ones that stand a check DOWN when the world it needed never came about.
//
// It imports nothing of the build and nothing of any engine. What it drives the
// game through is {@link Scene}, a structural reading of the surface's
// imperative form that every engine's harness already satisfies, so the same
// scenario code runs in process against Simple 2D and Structured 2D and over a
// page under Playwright. Every operation it calls is one specs/instrumentation.md
// fixes; nothing here fabricates an outcome.
//
// THREE IDEAS RUN THROUGH IT.
//
// 1. A SCENARIO REPORTS ITS OWN UPSETS. Most checks here are about a bystander:
//    a predator patrolling while the forager stands somewhere else, a cue that
//    should sound, a timer that should run. Those rest on things staying put, and
//    when one gives way the measurement is of a different situation than the item
//    describes — reported, left unguarded, against the SUBJECT. So a scenario
//    takes a picture of itself with {@link sceneGuard} and the item's first
//    assertion asks {@link sceneHeld} whether it was still standing at the end.
//
// 2. A PRECONDITION IS NOT A VERDICT. A check that reaches its subject by
//    swimming the forager into something cannot decide anything against a build
//    whose forager does not move, and neither can one watching a predator that
//    never travels. Those claims have items of their own that FAIL for them.
//    Everything downstream raises {@link PreconditionUnmet} instead, and
//    {@link graded} turns that into a skipped check, which the runner reads as
//    "the scenario was not constructible against this build" and decides nothing.
//
// 3. NOTHING STRIPS THE BOARD. Plankton sit on every corridor tile, and eating
//    the last one clears the maze, descends, and re-dens every predator
//    mid-measurement. A scenario therefore leaves the board FULL and settles the
//    one pellet the pose put under the forager with {@link clearUnderfoot}; a
//    posed fixture carries a sealed larder for the same reason (`fixtures.ts`).

import type { TestContext } from "vitest";
import { assertNull } from "./assert";
import {
  CARDINALS,
  denTiles,
  floodReachable,
  gateTiles,
  isPredOpen,
  openNeighborDirs,
  predatorReachable,
  tileAt,
  type Dir,
  type Grid,
  type MazeView,
  type Tile,
} from "./maze";

/* -------------------------------------------------------------------------- */
/* What a scenario reads and drives                                           */
/* -------------------------------------------------------------------------- */

/** The three hunters, as specs/predators.md names them. */
export type PredatorKind = "lanternjaw" | "gloamfin" | "flarefish";

/** What a predator is doing, as specs/state.md reports it. */
export type PredatorMode = "den" | "wander" | "chase" | "search";

/** The three states `setPredatorState` poses. */
export type PosedPredatorMode = "den" | "wander" | "chase";

/** The screens the state machine moves between. */
export type Screen =
  | "title"
  | "howto"
  | "countdown"
  | "playing"
  | "paused"
  | "cleared"
  | "gameover";

/** One predator, as much of it as a shared scenario reads. */
export interface ScenePredator {
  kind: PredatorKind;
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: Dir;
  state: PredatorMode;
  released: boolean;
  speed: number;
}

/**
 * As much of a snapshot as this module and `fixtures.ts` read.
 *
 * Structural, so an engine's own `FathomSnapshot` is one of these without any
 * conversion, and the checks keep the fuller type their `surface.ts` declares.
 */
export interface SceneSnapshot extends MazeView {
  grid: Grid;
  tiles: readonly string[];
  screen: Screen;
  lives: number;
  planktonRemaining: number;
  brightness: number;
  creatureAI: boolean;
  forager: { x: number; y: number; tx: number; ty: number; dir: Dir };
  predators: readonly ScenePredator[];
}

/**
 * The operations a shared scenario poses through, in the imperative form every
 * engine's harness presents them in.
 *
 * Each returns `unknown` because what an operation hands back is the harness's
 * business: Simple 2D's driver runs a pose through `engine.apply` and returns
 * nothing, a browser-driven harness returns a promise. A scenario awaits the
 * result either way, which is correct for both.
 */
export interface SceneDebug {
  beginPlay(): unknown;
  reset(options?: { seed?: number }): unknown;
  startDive(): unknown;
  setMaze(rows: readonly string[]): unknown;
  setForagerTile(tx: number, ty: number): unknown;
  setForagerDir(dir: Dir): unknown;
  setBrightness(g: number): unknown;
  setCreatureAI(enabled: boolean): unknown;
  setPredatorTile(index: number, tx: number, ty: number): unknown;
  setPredatorDir(index: number, dir: Dir): unknown;
  setPredatorState(index: number, value: PosedPredatorMode): unknown;
}

/** The game, as a shared scenario drives it. */
export interface Scene {
  snapshot(): SceneSnapshot | Promise<SceneSnapshot>;
  advance(frames: number): void | Promise<void>;
  readonly debug: SceneDebug;
}

/* -------------------------------------------------------------------------- */
/* Preconditions                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The scenario a check needed could not be brought about against this build.
 *
 * This is not a verdict. The claim it stands on has an item of its own that
 * fails for it, and a check that merely passed through the broken behavior on
 * its way somewhere else has nothing to say. A run that reported nine mechanics
 * broken because one build's forager could not swim is what this exists to
 * prevent: every one of those verdicts was true of what happened and useless as
 * a finding.
 */
export class PreconditionUnmet extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "PreconditionUnmet";
  }
}

/** Raise an unmet precondition, naming what was missing and who owns it. */
export function unmetPrecondition(reason: string): never {
  throw new PreconditionUnmet(reason);
}

/**
 * Run a validator's body, standing the check DOWN if the scenario could not be
 * posed.
 *
 * Every check in this suite opens with it:
 *
 * ```ts
 * it("holding ArrowRight swims the forager right", async (ctx) => {
 *   await graded(ctx, async () => {
 *     // pose, drive, assert
 *   });
 * });
 * ```
 *
 * A {@link PreconditionUnmet} becomes `ctx.skip`, which the runner reads as a
 * check that decided nothing; a suite whose checks all skip is reported as
 * inconclusive about the build rather than as a failure. Everything else — every
 * assertion, every error out of the build — travels on untouched, so nothing here
 * can turn a failing check into a passing one.
 */
export async function graded(
  ctx: TestContext,
  scenario: () => void | Promise<void>,
): Promise<void> {
  try {
    await scenario();
  } catch (error) {
    if (error instanceof PreconditionUnmet) {
      // Throws, which is how the check stops here. It is deliberately outside
      // the `try` above's reach.
      ctx.skip(error.message);
    }
    throw error;
  }
}

/**
 * How far a body must have travelled before a scenario will believe it moved at
 * all, in logical units.
 *
 * An eighth of a tile: far below the tile-and-more these scenarios actually
 * need, and far above the rounding of a single step.
 */
export const MOTION_EPS = 4;

/**
 * Stand a check down whose forager never moved under a held key.
 *
 * Plenty of checks are not about movement at all — what one plankton is worth,
 * what clearing the maze pays, whether a cue sounds — but reach their subject by
 * swimming the forager into something. Whether the forager moves is
 * `controls/*` and `maze-movement/*`'s verdict to give, and they give it.
 */
export function requireSwim(
  before: { x: number; y: number },
  after: { x: number; y: number },
  what: string,
): void {
  const moved = Math.hypot(after.x - before.x, after.y - before.y);
  if (moved >= MOTION_EPS) return;
  unmetPrecondition(
    `the forager did not move under a held key (${moved.toFixed(1)} units), so it ` +
      `could not ${what}; whether it moves at all is the movement checks' verdict, ` +
      `not this one's`,
  );
}

/**
 * The same refusal for a scenario whose subject is a predator that never
 * travelled.
 *
 * Every predator in specs/predators.md moves under its own power at a speed that
 * file fixes, so a hunter that covers no ground across a whole measurement has
 * not exhibited the behavior being graded, and the check cannot tell a wrong
 * answer from no answer. Deliberately NOT for a check that is about a predator
 * staying put: a denned hunter, or one held as scenery with the minds off,
 * legitimately measures zero.
 */
export function requirePredatorMotion(
  before: SceneSnapshot,
  after: SceneSnapshot,
  kind: PredatorKind,
  what: string,
): void {
  const a = pred(before, kind);
  const b = pred(after, kind);
  // A missing predator is the roster's verdict, not this one's.
  if (a === undefined || b === undefined) return;
  const moved = Math.hypot(b.x - a.x, b.y - a.y);
  if (moved >= MOTION_EPS) return;
  unmetPrecondition(
    `the ${kind} did not move at all (${moved.toFixed(1)} units) while the scenario ` +
      `waited for it to ${what}; whether a predator travels under its own power is ` +
      `the den and patrol checks' verdict, not this one's`,
  );
}

/* -------------------------------------------------------------------------- */
/* The roster                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The first predator of `kind` on the roster, or `undefined`.
 *
 * specs/state.md lists the roster in release order, and specs/predators.md gives
 * depth 1 one of each kind, so at the depth every posed scenario runs at "the
 * Lanternjaw" names exactly one predator.
 */
export function pred(
  snapshot: SceneSnapshot,
  kind: PredatorKind,
): ScenePredator | undefined {
  return snapshot.predators.find((p) => p.kind === kind);
}

/** Where the first predator of `kind` sits in the roster, or `-1`. */
export function predIndex(snapshot: SceneSnapshot, kind: PredatorKind): number {
  return snapshot.predators.findIndex((p) => p.kind === kind);
}

/** Every roster index holding a predator of `kind`, in release order. */
export function predIndexes(
  snapshot: SceneSnapshot,
  kind: PredatorKind,
): number[] {
  return snapshot.predators.flatMap((p, index) =>
    p.kind === kind ? [index] : [],
  );
}

/**
 * How far `(x, y)` lies from the forager's center, in logical units.
 *
 * The one reading of "how far from the forager" in the suite. Every rule
 * specs/sensing.md and specs/predators.md state a range for — the light radius,
 * the Lanternjaw's and Flarefish's reach, the Gloamfin's close hearing, the
 * Kindle circle — is a straight-line distance between centers, so a check that
 * measured it any other way would be grading a different figure.
 */
export function fromForager(
  snapshot: SceneSnapshot,
  x: number,
  y: number,
): number {
  return Math.hypot(x - snapshot.forager.x, y - snapshot.forager.y);
}

/** How far the predator at roster `index` stands from the forager, in units. */
export function separation(snapshot: SceneSnapshot, index: number): number {
  const predator = snapshot.predators[index];
  return fromForager(snapshot, predator.x, predator.y);
}

/**
 * The roster index of the one predator a scenario is about, refusing to grade a
 * build whose roster does not carry it.
 *
 * A missing kind is `predators.roster`'s verdict; every check that poses one of
 * that kind stands down instead.
 */
export function requirePred(
  snapshot: SceneSnapshot,
  kind: PredatorKind,
): number {
  const index = predIndex(snapshot, kind);
  if (index < 0) {
    unmetPrecondition(
      `the roster carries no ${kind}, so this scenario has nothing to pose; the ` +
        `roster's contents are the progression checks' verdict, not this one's`,
    );
  }
  return index;
}

/* -------------------------------------------------------------------------- */
/* Holding a scenario still                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Park the forager as a BYSTANDER: on `tile` if one is named, otherwise where it
 * already stands, facing rock so it cannot leave.
 *
 * specs/movement.md has the forager travel while a movement action is held and
 * come to rest when none is, and `setForagerTile` leaves it at rest. What pins
 * it here is the FACING: a body at rest "takes the desired direction when the
 * tile that way is open to it, and stays at rest otherwise", so a forager faced
 * into rock stays where it was put however long the scenario runs and whatever
 * the pose left buffered. A tile with no walled side keeps its facing, which is
 * the best available and is what a resting build does anyway.
 *
 * Returns the snapshot taken after parking. Only for a scenario in which the
 * forager's own facing does not matter; a check that reads its heading poses that
 * heading itself.
 */
export async function parkForager(
  scene: Scene,
  tile?: Tile,
): Promise<SceneSnapshot> {
  const before = await scene.snapshot();
  const tx = tile ? tile.tx : before.forager.tx;
  const ty = tile ? tile.ty : before.forager.ty;
  const open = openNeighborDirs(before, tx, ty);
  const walled = CARDINALS.filter((dir) => !open.includes(dir));
  await scene.debug.setForagerTile(tx, ty);
  if (walled.length > 0) await scene.debug.setForagerDir(walled[0]);
  return scene.snapshot();
}

/**
 * Make the plankton under a just-posed forager a non-event: eat it, and put `G`
 * back to the zero a dive opens on.
 *
 * Plankton sit on every corridor tile, so a forager placed anywhere is standing
 * on one and eats it on the next step of the real simulation. One pellet is
 * `BRIGHT_PER_EAT` of brightness, which widens the light and widens the
 * Lanternjaw's and Flarefish's reach for a second or two while it decays. A
 * scenario that poses the forager somewhere and then measures a range, a decay,
 * or what a hunter can see from where it stands is otherwise measuring that
 * pellet as much as the build.
 *
 * THE TICK IS TAKEN WITH THE CREATURES' MINDS OFF. A tick of simulation is a tick
 * for everything, and several scenarios pose a predator and read its OPENING
 * state. Handed a free tick, a predator two tiles away senses the forager and is
 * already chasing before the check has looked. `setCreatureAI` suspends exactly
 * that initiative and nothing else (specs/instrumentation.md): the forager still
 * eats, which is the whole point of the tick. It is restored immediately.
 *
 * A scenario that wants the minds off for its own reasons says so after this.
 */
export async function clearUnderfoot(scene: Scene): Promise<void> {
  await scene.debug.setCreatureAI(false);
  await scene.advance(1);
  await scene.debug.setCreatureAI(true);
  await scene.debug.setBrightness(0);
}

/** What {@link denAll} put away, for {@link boardDisturbance} to judge against. */
export interface QuietBoard {
  /** The kinds posed into the den. */
  denned: PredatorKind[];
  /** The roster indices posed into the den. */
  indices: number[];
  lives: number;
  screen: Screen;
}

/**
 * Put every predator in the den except the kinds named, and report what was put
 * away.
 *
 * `setPredatorState(index, "den")` returns a predator to the chamber and
 * SUSPENDS its release time (specs/instrumentation.md), so it stays there for as
 * long as the scenario runs. That is what makes the rest of the board quiet
 * while one predator's behavior is read.
 *
 * The token it returns goes to {@link boardDisturbance} and {@link sceneGuard},
 * so a scenario that later finds its subject somewhere unexpected can name WHICH
 * predator broke the quiet rather than blaming the one it was watching.
 */
export async function denAll(
  scene: Scene,
  except: readonly PredatorKind[] = [],
): Promise<QuietBoard> {
  const before = await scene.snapshot();
  const denned: PredatorKind[] = [];
  const indices: number[] = [];
  for (const [index, predator] of before.predators.entries()) {
    if (except.includes(predator.kind)) continue;
    await scene.debug.setPredatorState(index, "den");
    denned.push(predator.kind);
    indices.push(index);
  }
  const after = await scene.snapshot();
  return { denned, indices, lives: after.lives, screen: after.screen };
}

/**
 * What broke the quiet board {@link denAll} posed, as a sentence, or `null`.
 *
 * When a long-running check finds its subject somewhere unexpected, the honest
 * question is whether the SUBJECT did something or whether the scenario stopped
 * holding. A predator posed into the den and now loose has broken the
 * precondition; a life lost returns every predator to the den at once, which
 * drops the subject into `"den"` through no fault of its own. Reported as "the
 * subject left its wander", both read as a finding about the subject, which is
 * exactly the wrong diagnosis.
 */
export function boardDisturbance(
  snapshot: SceneSnapshot,
  quiet: QuietBoard | undefined,
): string | null {
  if (quiet === undefined) return null;
  if (snapshot.lives < quiet.lives) {
    const held = quiet.denned.filter((kind) => pred(snapshot, kind));
    return (
      "the forager was caught and lost a life mid-measurement, which returns every " +
      "predator to the den" +
      (held.length > 0
        ? ` — and the ${held.join(" and ")} had been posed into the den, so nothing ` +
          "should have been loose to catch it"
        : "")
    );
  }
  const out = quiet.indices
    .map((index) => snapshot.predators[index])
    .filter((p) => p !== undefined && p.state !== "den");
  if (out.length > 0) {
    const names = out.map((p) => p.kind).join(" and ");
    return `the ${names} left the den it was posed into and disturbed the scenario`;
  }
  if (snapshot.screen !== quiet.screen) {
    return `the dive left ${quiet.screen} for ${snapshot.screen} mid-measurement`;
  }
  return null;
}

/**
 * One predator as the scenario posed it, and the ground it could travel from
 * there.
 *
 * `reach` is every tile a predator may stand on that a corridor route joins to
 * the tile it was posed on, plus that tile itself. specs/movement.md closes rock
 * to a predator, so this is the whole of where it can ever be found — a hunter
 * read anywhere else got there by crossing rock, whatever else it was doing.
 * Including the posed tile is what keeps a hunter the pose left embedded in rock
 * gradeable: it cannot move, so a scenario built around it is still the one the
 * check meant to pose (`fixtures.ts`), and only its LEAVING is a finding.
 *
 * `reach` is `null` for a hunter the picture caught in the DEN, because it has
 * not been posed into the scenario yet: a check that reads a range at two
 * standoffs poses its subject out of the chamber and onto each of them in turn,
 * and where the chamber joins says nothing about where those are. Such a hunter
 * is still held to standing somewhere a predator may stand at all.
 */
export interface PosedPredator {
  kind: PredatorKind;
  tile: Tile;
  /** Whether {@link denAll} put this one away. */
  denned: boolean;
  /** Every tile it could swim to from `tile`, or `null` if it was in the den. */
  reach: ReadonlySet<string> | null;
  /** Whether any of those tiles is one the forager can also stand on. */
  meetsForager: boolean;
}

/**
 * The picture of a scenario {@link sceneGuard} takes, for {@link sceneHeld} and
 * {@link sceneBreakOwner}.
 */
export interface SceneWatch {
  quiet: QuietBoard | undefined;
  foragerParked: boolean;
  forager: Tile;
  lives: number;
  screen: Screen;
  /** The board as it was posed, for reading who could reach what. */
  board: MazeView;
  /** Every predator on the roster, in roster order. */
  posed: PosedPredator[];
}

/**
 * Take a picture of the scenario the moment it is posed, so the check can ask
 * whether it was still standing when the measurement ended.
 *
 * WHY EVERY BYSTANDER SCENARIO WANTS ONE. These checks are built on things
 * staying put: a predator posed into the den stays there, the forager stands
 * where it was parked, nobody is caught, the dive does not restart. When one of
 * those gives way the measurement is of a different situation than the item
 * describes.
 *
 * TAKE IT ONCE THE SCENARIO IS POSED, which is what the picture is of. It reads
 * the board and where every body stands on it, so a guard taken before the
 * subject has been put where the check wants it records the chamber the pose was
 * about to lift it out of instead. A hunter the picture catches in the den is
 * therefore held only to standing somewhere a predator may stand
 * ({@link PosedPredator}); everywhere else the picture is exact.
 *
 * Pair with {@link requireSceneHeld}. `quiet` is {@link denAll}'s return value;
 * pass `foragerParked: false` for a scenario in which the forager is meant to
 * travel.
 */
export async function sceneGuard(
  scene: Scene,
  quiet?: QuietBoard,
  options: { foragerParked?: boolean } = {},
): Promise<SceneWatch> {
  const snapshot = await scene.snapshot();
  const denned = new Set(quiet?.indices ?? []);
  const corridor = floodReachable(
    snapshot,
    snapshot.forager.tx,
    snapshot.forager.ty,
  );
  return {
    quiet,
    foragerParked: options.foragerParked ?? true,
    forager: { tx: snapshot.forager.tx, ty: snapshot.forager.ty },
    lives: snapshot.lives,
    screen: snapshot.screen,
    board: { grid: snapshot.grid, tiles: snapshot.tiles },
    posed: snapshot.predators.map((predator, index) => {
      const tile = { tx: predator.tx, ty: predator.ty };
      const chamber = tileAt(snapshot, tile.tx, tile.ty);
      if (chamber === "d" || chamber === "g") {
        return {
          kind: predator.kind,
          tile,
          denned: denned.has(index),
          reach: null,
          meetsForager: true,
        };
      }
      const reach = predatorReachable(snapshot, [tile]);
      reach.add(`${tile.tx},${tile.ty}`);
      return {
        kind: predator.kind,
        tile,
        denned: denned.has(index),
        reach,
        // A forager standing somewhere that is not corridor leaves nothing to
        // reason from, so the picture makes no claim about who can reach it.
        meetsForager:
          corridor.size === 0 || [...corridor].some((key) => reach.has(key)),
      };
    }),
  };
}

/**
 * What gave way since {@link sceneGuard} took its picture, as a sentence, or
 * `null` if nothing did.
 *
 * What a bystander check asks FIRST, so the failure itself carries the cause.
 * Reached through {@link requireSceneHeld}, which stands the check down instead
 * when what gave way is a claim another item owns; a check that owns one of those
 * claims asserts on this directly.
 */
export function sceneHeld(
  snapshot: SceneSnapshot,
  watch: SceneWatch,
): string | null {
  const disturbed = boardDisturbance(snapshot, watch.quiet);
  if (disturbed !== null) return disturbed;
  if (snapshot.lives < watch.lives) {
    return "the forager lost a life mid-measurement, which resets the board";
  }
  if (snapshot.screen !== watch.screen) {
    return `the dive left ${watch.screen} for ${snapshot.screen} mid-measurement`;
  }
  if (watch.foragerParked) {
    const { tx, ty } = snapshot.forager;
    if (tx !== watch.forager.tx || ty !== watch.forager.ty) {
      return (
        "the forager did not stay where the scenario parked it — it was at " +
        `(${watch.forager.tx}, ${watch.forager.ty}) and ended at (${tx}, ${ty}), ` +
        "so what was measured is not the situation this item describes"
      );
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Who owns a scenario that came apart                                        */
/* -------------------------------------------------------------------------- */

/** Whether nothing a predator may stand on leads out of this board's den. */
function denIsSealed(view: MazeView): boolean {
  const chamber = denTiles(view);
  if (chamber.length === 0) return false;
  const inside = new Set<string>(
    [...chamber, ...gateTiles(view)].map(({ tx, ty }) => `${tx},${ty}`),
  );
  for (const tile of predatorReachable(view, chamber)) {
    if (!inside.has(tile)) return false;
  }
  return true;
}

/**
 * What another item owns about the state this scenario ended in, or `null`.
 *
 * WHY THIS EXISTS. A bystander scenario is built out of rock. Rock is what keeps
 * a hunter in the ring it patrols, what seals the den the rest of the roster was
 * put into, and what holds a walled-in pair inside hearing range of each other
 * without either being able to reach the other. So a build whose predators cross
 * rock does not break ONE of these scenarios, it breaks every one of them at
 * once, and each reports the wreckage under its own heading. One `canEnter` that
 * answered `true` was graded as six findings: a ping that stopped, a flare that
 * never came, an ink cloud that failed to break a fix, and art that was never
 * drawn.
 *
 * `maze-movement/predators-keep-to-corridors` owns "a predator keeps to the
 * corridors" and fails for it on both the shapes specs/movement.md fixes;
 * `maze-movement/no-wall` owns the same rule for the forager; and
 * `controls/setmaze-houses-predators` owns "a posed board puts every hunter away
 * and holds it there". A scene that came apart one of those ways is theirs to
 * report, and every bystander stands aside — a decline rather than a pass, so the
 * point still reaches a reviewer.
 *
 * IT IS DELIBERATELY NARROW. Four shapes of break are handed over, each read off
 * the posed geometry rather than assumed:
 *
 *   - a predator is standing somewhere no corridor route joins to the tile the
 *     scenario posed it on, so it got there by crossing rock;
 *   - a predator the scenario put in a SEALED den is out of it, where sealed
 *     means nothing a predator may stand on leads out of the chamber;
 *   - a life was lost although no predator, from where the scenario posed it,
 *     could reach the corridor the forager stood in;
 *   - a parked forager left a tile with no open neighbor at all, so it went into
 *     rock.
 *
 * Everything else — a dive that left live play, a maze cleared mid-measurement, a
 * bystander forager that wandered off a tile it could legally leave — is nobody
 * else's claim, and stays a failure of the check that found it.
 */
export function sceneBreakOwner(
  snapshot: SceneSnapshot,
  watch: SceneWatch,
): string | null {
  const strayed = watch.posed.flatMap((posed, index) => {
    const now = snapshot.predators[index];
    if (now === undefined || now.kind !== posed.kind) return [];
    // A return to the den is a teleport rather than a swim, so where a denned
    // hunter is reported says nothing about the ground it covered.
    if (now.state === "den") return [];
    if (posed.reach === null) {
      if (isPredOpen(snapshot, now.tx, now.ty)) return [];
      return [
        `the ${now.kind} is at (${now.tx}, ${now.ty}), which is rock, and ` +
          "specs/movement.md closes rock to a predator",
      ];
    }
    if (posed.reach.has(`${now.tx},${now.ty}`)) return [];
    return [
      `the ${now.kind} is at (${now.tx}, ${now.ty}), which no corridor joins to ` +
        `the (${posed.tile.tx}, ${posed.tile.ty}) this scenario posed it on`,
    ];
  });
  if (strayed.length > 0) {
    return `${strayed.join("; ")}, so it crossed rock to get there`;
  }

  const sealed = denIsSealed(watch.board);

  if (snapshot.lives < watch.lives) {
    if (
      !watch.posed.some(
        (posed) => !(posed.denned && sealed) && posed.meetsForager,
      )
    ) {
      return (
        "the forager was caught although the fixture stood every predator behind " +
        "rock — nothing posed on this board could reach the corridor it was " +
        "standing in, so a hunter crossed rock to reach it"
      );
    }
    return null;
  }

  if (sealed) {
    const escaped = watch.posed.filter(
      (posed, index) =>
        posed.denned &&
        snapshot.predators[index] !== undefined &&
        snapshot.predators[index].state !== "den",
    );
    if (escaped.length > 0) {
      return (
        `the ${escaped.map((posed) => posed.kind).join(" and ")} left the sealed ` +
        "den this fixture posed it into, which carries rock on every side but the " +
        "gate and rock above that"
      );
    }
  }

  if (
    watch.foragerParked &&
    (snapshot.forager.tx !== watch.forager.tx ||
      snapshot.forager.ty !== watch.forager.ty) &&
    openNeighborDirs(watch.board, watch.forager.tx, watch.forager.ty).length ===
      0
  ) {
    return (
      `the forager left (${watch.forager.tx}, ${watch.forager.ty}), a tile with ` +
      "no open neighbor at all, so it went into rock"
    );
  }

  return null;
}

/**
 * The scenario held, or the check DECLINES to the item that owns what gave way.
 *
 * This is the first thing a bystander check asserts, in place of asserting on
 * {@link sceneHeld} directly:
 *
 * ```ts
 * const watch = await sceneGuard(h, quiet);
 * // ... drive the measurement ...
 * requireSceneHeld(after, watch);
 * ```
 *
 * A check that OWNS one of the claims {@link sceneBreakOwner} defers to asserts
 * on {@link sceneHeld} itself instead, because a decline there would leave the
 * defect ungraded by anything.
 */
export function requireSceneHeld(
  snapshot: SceneSnapshot,
  watch: SceneWatch,
  what = "the scenario held to the end",
): void {
  const owned = sceneBreakOwner(snapshot, watch);
  if (owned !== null) {
    const broke = sceneHeld(snapshot, watch);
    unmetPrecondition(
      `${owned}, so the scenario this check describes was over before it was ` +
        `read${broke === null ? "" : ` (${broke})`} — whether a body keeps to the ` +
        "corridors is maze-movement/predators-keep-to-corridors and " +
        "maze-movement/no-wall's verdict, and whether a posed board holds its " +
        "hunters is controls/setmaze-houses-predators's, not this one's",
    );
  }
  assertNull(sceneHeld(snapshot, watch), what);
}

/**
 * Keep a bystander creature clear of the forager, re-posing it when it wanders
 * inside `keepClear` logical units, and report how often that was needed.
 *
 * A static parking spot is no defence on a board a wanderer crosses in a few
 * seconds, and a scenario that watches a creature for tens of seconds cannot
 * simply hope. This polls the separation and puts the BYSTANDER back on `home`
 * when it closes, touching nothing else — the subject, the forager, the board and
 * the clock are all left exactly as they were.
 */
export async function keepApart(
  scene: Scene,
  index: number,
  home: Tile,
  keepClear: number,
): Promise<number> {
  const snapshot = await scene.snapshot();
  const creature = snapshot.predators[index];
  if (creature === undefined) return 0;
  const gap = fromForager(snapshot, creature.x, creature.y);
  if (gap >= keepClear) return 0;
  await scene.debug.setPredatorTile(index, home.tx, home.ty);
  return 1;
}
