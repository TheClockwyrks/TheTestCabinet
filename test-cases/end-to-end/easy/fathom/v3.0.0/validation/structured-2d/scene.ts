// Fathom — scenario integrity. CASE-PROVIDED.
//
// WHAT IS SHARED. This file is byte-identical in `validation/none/`,
// `validation/simple-2d/` and `validation/structured-2d/`. Like `fixtures.ts` it
// drives the game, and like `fixtures.ts` it drives it through a structural
// reading of the harness — {@link SceneHost} — rather than through any engine's
// own type, so the readings a check takes are one set of readings under all
// three. Every pure part of it lives in `maze.ts` instead: the reachability
// walks, the sealed-den test, the walled-side reading.
//
// WHAT IS NOT SHARED, AND WHY. One thing, named here so it is not mistaken for
// drift. {@link SceneHost.trespasses} and {@link SceneHost.denReleases} are LOGS
// THE HARNESS KEEPS while it advances, and how often a harness can afford to
// look is the harness's business: an in-process harness reads a snapshot for
// nothing, and the engineless one reads across a page boundary. Every harness in
// this case fills both, and this module reads them the same way whatever is in
// them, so a harness that could not afford the watch would report empty logs and
// the end-of-measurement readings below would carry the whole attribution.
//
// WHY ANY OF THIS EXISTS. Most points in this suite are about ONE thing while
// several others are held still around it: a hunter posed into the den stays
// there, the forager stands where it was parked, nobody is caught, the dive does
// not restart. When one of those gives way, what was measured is a different
// situation from the one the point describes — and, left unguarded, it is
// reported against the SUBJECT. A run had its forager rested in the ring a
// fixture keeps a hunter in; the hunter heard it and ate it, and eleven checks
// reported the hunter's speed, its silence, its flare cadence. Every one of
// those verdicts was true of what happened and useless as a finding. Another
// run's predators never moved a pixel, and ten checks reported that as ink
// failing to break a fix, cornering failing to cost speed, a lost-you ping never
// firing, and contact never costing a life.
//
// SO THERE ARE TWO DEVICES HERE, and they answer two different questions.
//
//   THE SCENE GUARD asks "did the situation I posed survive the measurement?"
//   {@link sceneGuard} takes a picture of the arrangement the moment it
//   finished, and a bystander point's FIRST assertion is
//   {@link requireSceneHeld}, so a scenario that gave way names what gave way
//   instead of blaming its subject.
//
//   A PRECONDITION asks "can this build reach the scenario at all?" A forager
//   that cannot swim, a predator that never moves, a roster with no hunter of
//   the kind a scenario poses — those are real defects, and they belong to the
//   points that OWN them. Everything downstream declines through
//   {@link unmetPrecondition} and stands aside, so the grade names the one
//   broken thing once rather than nine mechanics that were fine.
//
// WHICH CLAIMS HAVE AN OWNER, AND WHO OWNS THEM. `maze-movement/no-wall` owns
// the forager keeping to the corridors and
// `maze-movement/predators-keep-to-corridors` owns the hunters doing the same,
// so a scene that came apart because a body crossed rock is a decline
// everywhere else. `controls/setmaze-houses-predators` owns a pose putting every
// hunter away and holding it there, so a hunter this scenario denned that
// reports itself released, or walks out of a sealed chamber, is a decline too.
// `controls/*` and `maze-movement/*` own the forager travelling at all
// ({@link requireSwim}), the den and patrol points own a predator travelling at
// all ({@link requirePredatorMotion}), and `scoring/depth-scaling` owns what the
// roster carries ({@link requireKind}). A scene that came apart for a reason
// NOTHING else owns still FAILS, because otherwise the fault goes ungraded.

import { it, type TestContext } from "vitest";
import { fail } from "./assert";
import {
  faceWall,
  placeForager,
  type Awaitable,
  type FixtureBoard,
  type FixtureHost,
  type FixtureOps,
  type PredatorView,
} from "./fixtures";
import {
  corridorDirs,
  denIsSealed,
  floodReachable,
  isDenOrGate,
  isPredatorOpen,
  predatorReachable,
  tileKey,
  type Dir,
  type MazeView,
  type Tile,
} from "./maze";

/* -------------------------------------------------------------------------- */
/* What a scenario reads and drives                                           */
/* -------------------------------------------------------------------------- */

/** The board and the run, as much of both as this module reads. */
export interface SceneView extends FixtureBoard {
  lives: number;
  planktonRemaining: number;
  brightness: number;
}

/** The operations a scene helper calls beyond the ones a poser needs. */
export interface SceneOps extends FixtureOps {
  setBrightness(g: number): Awaitable<void>;
  setCreatureAI(enabled: boolean): Awaitable<void>;
}

/** The point that owns the forager keeping to the corridors. */
export const FORAGER_CORRIDORS = "maze-movement/no-wall";

/** The point that owns the hunters keeping to the corridors. */
export const PREDATOR_CORRIDORS = "maze-movement/predators-keep-to-corridors";

/** The point that owns a pose putting a hunter away and the schedule staying put. */
export const HOUSED_PREDATORS = "controls/setmaze-houses-predators";

/**
 * A body found standing where movement cannot have carried it, as the harness
 * logs it while a check drives the game.
 *
 * `specs/movement.md` confines every body to the tiles open to it — the forager
 * to corridor, a predator to corridor and, while it is in the den, the chamber
 * and its gate — so a body whose reported tile is rock or off the board did not
 * get there by travelling. A harness samples for this as it advances, because
 * the evidence does not survive: a hunter that walks through rock, eats the
 * forager and is returned to the den by the life it cost stands on a den tile by
 * the time the check looks.
 */
export interface Trespass {
  /** The phrase the decline reports, naming the body and the tile. */
  where: string;
  /** The point that owns the claim this trespass breaks. */
  owner: string;
  /** The simulated time it was first seen at, in seconds. */
  at: number;
}

/**
 * A predator in the den that reported its release, as the harness logs it.
 *
 * A scenario that poses a hunter into the den ({@link denAll}) is entitled to
 * find it there for as long as it runs: `specs/instrumentation.md` returns it to
 * a den tile with `released` false and SUSPENDS its release time, so no release
 * time arrives while the pose stands. A build that grants it anyway walks the
 * hunter out through the gate and into whatever was being measured.
 *
 * THE READING IS THE FLAG, NOT THE DEPARTURE, for two reasons. It is the fact
 * `controls/setmaze-houses-predators` decides — that point watches a posed den
 * and asserts that none of its hunters reports `released` — so it is the fact
 * the decline should name. And the departure itself can pass between two of the
 * harness's own looks: a hunter one tile from the gate steps onto the corridor
 * and onto the forager inside a single tick, and the life it takes returns every
 * hunter to the den, so by the time the check looks nothing is out of place.
 */
export interface DenRelease {
  /** Its index on the roster, which is how a scenario knows it posed this one. */
  index: number;
  /** The phrase the decline reports. */
  where: string;
  /** The simulated time it was first seen at, in seconds. */
  at: number;
}

/** What a scenario helper needs of a harness. */
export interface SceneHost extends FixtureHost {
  readonly debug: SceneOps;
  snapshot(): Awaitable<SceneView>;
  advance(ticks: number): Awaitable<void>;
  /**
   * Run ticks that cost a captured section nothing, for setup rather than for
   * measurement. A harness whose recorder is bounded by the section a check
   * opens answers this with an ordinary advance.
   */
  skip(ticks: number): Awaitable<void>;
  /**
   * Every trespass this harness has seen, oldest first, growing as the game is
   * advanced. {@link sceneGuard} marks its length so a check judges only what
   * happened after its own arrangement finished.
   */
  readonly trespasses: readonly Trespass[];
  /**
   * Every release granted to a denned hunter this harness has seen, oldest
   * first. See {@link DenRelease}.
   */
  readonly denReleases: readonly DenRelease[];
}

/* -------------------------------------------------------------------------- */
/* Declining, and how a check is declared                                     */
/* -------------------------------------------------------------------------- */

/**
 * The scenario a check needed could not be brought about against this build.
 *
 * This is not a verdict. The claim it stands on has a point of its own that
 * fails for it, and a check that merely passed through the broken behavior on
 * its way somewhere else has nothing to say about it.
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
 * Declare a review point's check.
 *
 * Every point in this suite states its test through this rather than through
 * vitest's `it`, because a check has three outcomes here and `it` gives two. A
 * {@link PreconditionUnmet} raised anywhere inside becomes `ctx.skip`, which the
 * runner reads as a check that DECIDED NOTHING, and a suite whose checks all
 * skip is reported as inconclusive about the build rather than as a failure.
 * Everything else — every assertion, every error out of the build — travels on
 * untouched, so nothing here can turn a failing check into a passing one.
 */
export function check(name: string, body: () => Promise<void>): void {
  it(name, async (ctx: TestContext) => {
    try {
      await body();
    } catch (error) {
      if (error instanceof PreconditionUnmet) {
        // Throws, which is how the check stops here. Deliberately outside the
        // `try` above's reach.
        ctx.skip(error.message);
      }
      throw error;
    }
  });
}

/**
 * Stand a check down whose subject was never reached, naming the point that owns
 * the claim instead of the mechanic this check happens to be about.
 *
 * The `Expected:` line names the requirement the build actually missed and the
 * point whose job it is to report it, so a reviewer reading the decline learns
 * where the verdict is, and this check records none.
 */
export function failPrecondition(
  requirement: string,
  owner: string,
  actual: unknown,
): never {
  return unmetPrecondition(
    `Expected: ${requirement} — a verdict for ${owner} to give, not this ` +
      `one's\nActual: ${String(actual)}`,
  );
}

/**
 * The same refusal, for a reason that does not decompose into a requirement and
 * an owner.
 *
 * {@link failPrecondition} is the preferred shape, because a reader of the
 * `Expected:` line alone learns which point owes the verdict. Some deferrals do
 * not split that cleanly — a fixture that could not be stamped, a hunter that
 * never left the den, a roster that arrived empty — and their reason is one
 * sentence that already names its owner. This is that sentence, declined the
 * same way and with the same consequence: the check decides nothing, and the
 * point it names decides instead.
 */
export function standDown(reason: string): never {
  return unmetPrecondition(
    `Expected: a scenario this check could grade\nActual: ${reason}`,
  );
}

/**
 * How far a body must travel before a scenario will believe it can move at all,
 * in logical units.
 *
 * An eighth of a tile: far below the tile-and-a-bit these scenarios actually
 * need, and far above the rounding of a single step.
 */
export const MOTION_EPS = 4;

/* -------------------------------------------------------------------------- */
/* Reading the roster                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The predator at `index` of the roster, or `undefined` where the roster is
 * shorter than that.
 *
 * `specs/state.md` lists the roster in release order and fixes one stable index
 * per predator for as long as that roster stands, which is the index every
 * predator operation selects by. A missing entry is the roster's own verdict
 * (`scoring/depth-scaling`), so nothing here throws over one.
 */
export function predatorAt(
  snapshot: SceneView,
  index: number,
): PredatorView | undefined {
  return snapshot.predators[index];
}

/** The index of the first predator of `kind`, or `-1` where the roster has none. */
export function indexOfKind(snapshot: SceneView, kind: string): number {
  return snapshot.predators.findIndex((one) => one.kind === kind);
}

/** The first predator of `kind`, or `undefined` where the roster has none. */
export function predatorOf(
  snapshot: SceneView,
  kind: string,
): PredatorView | undefined {
  return snapshot.predators.find((one) => one.kind === kind);
}

/**
 * The roster index of the first predator of `kind`, or a refusal naming the
 * point that owns a roster too short to hold it.
 *
 * `specs/predators.md` puts one of each kind in the den at depth `1` and
 * `specs/state.md` lists the roster in release order, so at the depth every
 * posed scenario runs at, a kind names exactly one predator. A roster that does
 * not carry it is `scoring/depth-scaling`'s verdict rather than any posing
 * point's.
 */
export function requireKind(snapshot: SceneView, kind: string): number {
  const index = indexOfKind(snapshot, kind);
  if (index >= 0) return index;
  failPrecondition(
    `the roster to carry a ${kind}, so this scenario could be posed; ` +
      "specs/predators.md puts one of each kind in the den at depth 1",
    "scoring/depth-scaling",
    snapshot.predators.map((one) => one.kind).join(", ") || "an empty roster",
  );
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

/* -------------------------------------------------------------------------- */
/* Holding the rest of the board still                                        */
/* -------------------------------------------------------------------------- */

/**
 * What {@link denAll} put away, and the run it left behind, for
 * {@link boardDisturbance} to judge a later snapshot against.
 */
export interface Quiet {
  /** The roster indices posed into the den, and the kind each one was. */
  denned: { index: number; kind: string }[];
  lives: number;
  screen: string;
}

/**
 * Pose every predator into the den except the ones at `except`, so a check reads
 * one hunter's behavior undisturbed.
 *
 * `specs/instrumentation.md` has `setPredatorState(index, "den")` return the
 * predator to a den tile, clear its `released` flag and SUSPEND its release
 * time, so it stays in the chamber for as long as the scenario runs. That is
 * what makes the rest of the board quiet while one predator is read.
 *
 * The token it returns is what lets a scenario that later finds its subject in
 * an unexpected state say WHICH predator broke the quiet, rather than blaming
 * the one it was watching.
 */
export async function denAll(
  h: SceneHost,
  except: readonly number[] = [],
): Promise<Quiet> {
  const before = await h.snapshot();
  const denned: { index: number; kind: string }[] = [];
  for (const [index, predator] of before.predators.entries()) {
    if (except.includes(index)) continue;
    await h.debug.setPredatorState(index, "den");
    denned.push({ index, kind: predator.kind });
  }
  const after = await h.snapshot();
  return { denned, lives: after.lives, screen: after.screen };
}

/**
 * What broke the quiet board {@link denAll} posed, as a sentence, or `null` when
 * nothing did.
 *
 * When a long-running check finds its subject somewhere unexpected, the honest
 * question is whether the SUBJECT did something or whether the scenario stopped
 * holding. A predator posed into the den and now loose has broken the
 * precondition; a life lost returns every predator to the den at once
 * (`specs/progression.md`), which drops the subject into `"den"` through no
 * fault of its own. Reported as "the subject left its wander", both of those
 * read as a finding about the subject, which is exactly the wrong diagnosis.
 */
export function boardDisturbance(
  snapshot: SceneView,
  quiet: Quiet | null,
): string | null {
  if (quiet === null) return null;
  if (snapshot.lives < quiet.lives) {
    const held = quiet.denned.map((one) => one.kind);
    return (
      "the forager was caught and lost a life mid-measurement, which returns " +
      "every predator to the den" +
      (held.length > 0
        ? `, and the ${held.join(" and ")} had been posed into the den, so ` +
          "nothing should have been loose to catch it"
        : "")
    );
  }
  const out = quiet.denned.filter((one) => {
    const predator = snapshot.predators[one.index];
    return predator !== undefined && predator.state !== "den";
  });
  if (out.length > 0) {
    return (
      `the ${out.map((one) => one.kind).join(" and ")} left the den it was ` +
      "posed into and disturbed the scenario"
    );
  }
  if (snapshot.screen !== quiet.screen) {
    return `the dive left ${quiet.screen} for ${snapshot.screen} mid-measurement`;
  }
  return null;
}

/**
 * Make the plankton under a just-placed forager a non-event: eat it, and put `G`
 * back to the zero a dive opens on.
 *
 * WHY A POSE NEEDS THIS. A maze carries a plankton on every corridor tile
 * (`specs/gameplay.md`), so a forager placed anywhere is standing on one and
 * eats it on the next tick of the real simulation. One pellet is
 * `BRIGHT_PER_EAT`, which is not nothing: it widens the light pocket, and it
 * widens the Lanternjaw's and the Flarefish's reach for a second or two while it
 * decays. A scenario that places the forager somewhere and then measures a
 * range, a decay, or what a hunter can see from where it stands would be
 * measuring that pellet as much as the build.
 *
 * THE TICK IS TAKEN WITH THE CREATURES' MINDS OFF. A tick of simulation is a
 * tick for everything, and several scenarios pose a predator and then read its
 * OPENING state. Handed a free tick, a hunter two tiles from the forager senses
 * it and is already chasing before the check has looked. `setCreatureAI(false)`
 * suspends exactly that initiative and nothing else
 * (`specs/instrumentation.md`): the forager still eats, which is the whole point
 * of the tick. The minds go straight back on, so a scenario that wants them off
 * says so after this call.
 *
 * `skip` rather than `advance`, because this is setup: it must cost a captured
 * section nothing.
 */
export async function clearUnderfoot(h: SceneHost): Promise<void> {
  await h.debug.setCreatureAI(false);
  await h.skip(1);
  await h.debug.setCreatureAI(true);
  await h.debug.setBrightness(0);
}

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

/**
 * Park the forager as a bystander and leave the board in a state no amount of
 * grazing can end the round from.
 *
 * THE OBVIOUS ALTERNATIVE IS THE BUG. Stripping the board to a single pellet
 * does keep a drifting forager from grazing for long, but it leaves the maze one
 * mouthful from CLEARED, with that mouthful next to the forager: a build whose
 * forager carries on to the next center ate it, the maze cleared, the dive
 * descended, every predator was re-denned, and whatever the scenario was
 * watching ended mid-measurement — reported, of course, against the subject.
 *
 * So the board is left FULL instead. Nothing about a full board can end the
 * round: a generated maze carries hundreds of pellets, and every posed fixture
 * carries a sealed larder for the same reason. What that costs is the one pellet
 * under the forager, which {@link clearUnderfoot} settles.
 */
export async function quietBoard(h: SceneHost, tile?: Tile): Promise<void> {
  await parkForager(h, tile);
  await clearUnderfoot(h);
}

/* -------------------------------------------------------------------------- */
/* The scene guard                                                            */
/* -------------------------------------------------------------------------- */

/**
 * One predator as the scenario posed it, and the ground it could travel from
 * there.
 *
 * `reach` is every tile a predator may stand on that a route over corridor, den
 * and gate joins to the tile it was posed on, plus that tile itself.
 * `specs/movement.md` closes rock to a predator, so this is the whole of where
 * it can ever be found — a hunter read anywhere else got there by crossing rock,
 * whatever else it was doing. Including the posed tile is what keeps a hunter
 * the pose left embedded in rock gradeable: it cannot move, so a scenario built
 * around it is still the one the check meant to pose (`fixtures.ts`), and only
 * its LEAVING is a finding.
 *
 * `reach` is `null` for a hunter the picture caught in the DEN, because it has
 * not been posed into the scenario yet: a check that reads a range at two
 * standoffs poses its subject out of the chamber and onto each of them in turn,
 * and where the chamber joins says nothing about where those are. Such a hunter
 * is still held to standing somewhere a predator may stand at all.
 */
export interface PosedPredator {
  kind: string;
  tile: Tile;
  /** Whether {@link denAll} put this one away. */
  denned: boolean;
  /** Every tile it could travel to from `tile`, or `null` if it was in the den. */
  reach: ReadonlySet<string> | null;
  /** Whether any of those tiles is one the forager can also stand on. */
  meetsForager: boolean;
}

/** The picture {@link sceneGuard} took, for {@link sceneHeld} to judge against. */
export interface SceneGuard {
  quiet: Quiet | null;
  foragerParked: boolean;
  forager: Tile;
  lives: number;
  screen: string;
  /** The board the scenario was posed on, which is what pens the bodies in. */
  board: MazeView;
  /** Every predator on the roster, in roster order. */
  posed: PosedPredator[];
  /** The harness's trespass log, read live when the scene is judged. */
  trespasses: readonly Trespass[];
  /** How long that log was when the arrangement finished. */
  trespassMark: number;
  /** The harness's den-release log, read live when the scene is judged. */
  denReleases: readonly DenRelease[];
  /** How long that log was when the arrangement finished. */
  denReleaseMark: number;
}

/**
 * Take a picture of the scenario the moment its arrangement finished, so a check
 * can ask whether it was still standing when the measurement ended.
 *
 * TAKE IT ONCE THE SCENARIO IS POSED, which is what the picture is of. It reads
 * the board and where every body stands on it, so a guard taken before the
 * subject has been put where the check wants it records the chamber the pose was
 * about to lift it out of instead. A hunter the picture catches in the den is
 * therefore held only to standing somewhere a predator may stand
 * ({@link PosedPredator}); everywhere else the picture is exact. A check that
 * RE-POSES a body part-way through takes a fresh guard at that point.
 *
 * Pair with {@link requireSceneHeld}. `quiet` is {@link denAll}'s token, where
 * the scenario posed one; pass `foragerParked: false` for a scenario in which
 * the forager is meant to travel.
 */
export async function sceneGuard(
  h: SceneHost,
  quiet: Quiet | null = null,
  options: { foragerParked?: boolean } = {},
): Promise<SceneGuard> {
  const snapshot = await h.snapshot();
  const board: MazeView = { grid: snapshot.grid, tiles: snapshot.tiles };
  const denned = new Set(quiet?.denned.map((one) => one.index) ?? []);
  const corridor = floodReachable(
    board,
    snapshot.forager.tx,
    snapshot.forager.ty,
  );
  return {
    quiet,
    foragerParked: options.foragerParked ?? true,
    forager: { tx: snapshot.forager.tx, ty: snapshot.forager.ty },
    lives: snapshot.lives,
    screen: snapshot.screen,
    board,
    posed: snapshot.predators.map((predator, index) => {
      const tile: Tile = { tx: predator.tx, ty: predator.ty };
      if (isDenOrGate(board, tile.tx, tile.ty)) {
        return {
          kind: predator.kind,
          tile,
          denned: denned.has(index),
          reach: null,
          meetsForager: true,
        };
      }
      const reach = predatorReachable(board, [tile]);
      reach.add(tileKey(tile));
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
    trespasses: h.trespasses,
    trespassMark: h.trespasses.length,
    denReleases: h.denReleases,
    denReleaseMark: h.denReleases.length,
  };
}

/**
 * What gave way since {@link sceneGuard} took its picture, as a sentence, or
 * `null` when nothing did.
 *
 * What a bystander check asks FIRST, through {@link requireSceneHeld}, which
 * stands the check down instead when what gave way is a claim another point
 * owns. Exported because a point that OWNS one of those claims reads this
 * directly: a decline there would leave the defect ungraded by anything.
 */
export function sceneHeld(
  snapshot: SceneView,
  guard: SceneGuard,
): string | null {
  const disturbed = boardDisturbance(snapshot, guard.quiet);
  if (disturbed !== null) return disturbed;
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

/**
 * Every trespass logged since the scenario's arrangement finished.
 *
 * A body already standing on rock when the guard was taken is the arrangement's
 * own business — `fixtures.ts` decides that at pose time — so a check judges only
 * what happened while it was measuring.
 */
export function trespassesSince(guard: SceneGuard): Trespass[] {
  return guard.trespasses.slice(guard.trespassMark);
}

/** What broke a scene, and the point whose verdict that is. */
export interface SceneBreak {
  /** What gave way, as a sentence. */
  reason: string;
  /** The point, or points, that own it and fail for it. */
  owner: string;
}

/**
 * The point that owns the reason this scene came apart, or `null` where nothing
 * does.
 *
 * WHY THIS EXISTS. A bystander scenario is built out of ROCK. Rock is what keeps
 * a hunter in the ring it patrols, what seals the den the rest of the roster was
 * put into, and what holds a walled-in pair inside hearing range of each other
 * without either being able to reach the other. So a build whose bodies cross
 * rock does not break ONE of these scenarios, it breaks every one of them at
 * once, and each reports the wreckage under its own heading: one `canEnter`
 * answering `true` was graded as a ping that stopped, a flare that never came,
 * an ink cloud that failed to break a fix, and art that was never drawn.
 *
 * SIX READINGS, IN ORDER, each of them taken off the posed scene rather than
 * assumed, and none of them possible on a conforming build. The first two are
 * the harness's own log of what happened DURING the measurement, because the
 * evidence does not survive to the end of one; the rest are read off the state
 * the measurement ended in, which catches what fell between two of the
 * harness's looks.
 *
 *   - a body was seen standing on rock, or off the board;
 *   - a hunter this scenario denned was granted its release, whose release time
 *     the operation that denned it suspended;
 *   - a predator ended somewhere no route over corridor, den and gate joins to
 *     the tile the scenario posed it on, so it got there by crossing rock;
 *   - a hunter this scenario put in a SEALED den is out of it, where sealed
 *     means nothing a predator may stand on leads out of the chamber;
 *   - a life was lost although no predator, from where the scenario posed it,
 *     could reach the corridor the forager stood in;
 *   - a parked forager left a tile with no corridor neighbor at all, so it went
 *     into rock.
 *
 * Everything else — a dive that left live play, a maze cleared mid-measurement,
 * a bystander forager that wandered off a tile it could legally leave — is
 * nobody else's claim, and stays a failure of the check that found it.
 *
 * `owns` names the claims the CALLING point owns, as the points that own them,
 * so `maze-movement/no-wall` and `maze-movement/predators-keep-to-corridors`
 * report a break of their own claim as their own finding rather than declining
 * on it.
 */
export function sceneBreakOwner(
  snapshot: SceneView,
  guard: SceneGuard,
  owns: readonly string[] = [],
): SceneBreak | null {
  const stepped = trespassesSince(guard).filter(
    (one) => !owns.includes(one.owner),
  );
  if (stepped.length > 0) {
    const owners = [...new Set(stepped.map((one) => one.owner))];
    return {
      reason:
        `${stepped.map((one) => one.where).join("; ")} — specs/movement.md ` +
        "confines every body to the tiles open to it, and a body that crosses " +
        "rock takes apart the rock this scenario is held together by",
      owner: owners.join(" and "),
    };
  }

  const posedDen = guard.quiet?.denned ?? [];
  const granted = guard.denReleases
    .slice(guard.denReleaseMark)
    .filter((one) => posedDen.some((denned) => denned.index === one.index));
  if (granted.length > 0 && !owns.includes(HOUSED_PREDATORS)) {
    return {
      reason:
        `${granted.map((one) => one.where).join("; ")} — a pose that dens a ` +
        "hunter suspends its release time (specs/instrumentation.md), so no " +
        "release time arrives while this scenario stands, and a hunter " +
        "granted one anyway comes out through the gate",
      owner: HOUSED_PREDATORS,
    };
  }

  if (!owns.includes(PREDATOR_CORRIDORS)) {
    const strayed = guard.posed.flatMap((posed, index) => {
      const now = snapshot.predators[index];
      if (now === undefined || now.kind !== posed.kind) return [];
      // A return to the den is a teleport rather than a swim, so where a denned
      // hunter is reported says nothing about the ground it covered.
      if (now.state === "den") return [];
      if (posed.reach === null) {
        if (isPredatorOpen(guard.board, now.tx, now.ty)) return [];
        return [
          `the ${now.kind} is at (${now.tx}, ${now.ty}), which is rock, and ` +
            "specs/movement.md closes rock to a predator",
        ];
      }
      if (posed.reach.has(tileKey(now))) return [];
      return [
        `the ${now.kind} is at (${now.tx}, ${now.ty}), which no route over ` +
          `corridor, den and gate joins to the (${posed.tile.tx}, ` +
          `${posed.tile.ty}) this scenario posed it on`,
      ];
    });
    if (strayed.length > 0) {
      return {
        reason: `${strayed.join("; ")}, so it crossed rock to get there`,
        owner: PREDATOR_CORRIDORS,
      };
    }
  }

  const sealed = denIsSealed(guard.board);

  if (snapshot.lives < guard.lives) {
    if (
      !guard.posed.some(
        (posed) => !(posed.denned && sealed) && posed.meetsForager,
      )
    ) {
      return {
        reason:
          "the forager was caught although the scenario stood every predator " +
          "behind rock — nothing posed on this board could reach the corridor " +
          "it was standing in, so a hunter crossed rock to reach it",
        owner: `${HOUSED_PREDATORS} and ${PREDATOR_CORRIDORS}`,
      };
    }
    return null;
  }

  if (sealed && !owns.includes(HOUSED_PREDATORS)) {
    const escaped = guard.posed.filter(
      (posed, index) =>
        posed.denned &&
        snapshot.predators[index] !== undefined &&
        snapshot.predators[index].state !== "den",
    );
    if (escaped.length > 0) {
      return {
        reason:
          `the ${escaped.map((posed) => posed.kind).join(" and ")} left the ` +
          "sealed den this fixture posed it into, which carries rock on every " +
          "side but the gate and rock above that",
        owner: HOUSED_PREDATORS,
      };
    }
  }

  if (
    guard.foragerParked &&
    !owns.includes(FORAGER_CORRIDORS) &&
    (snapshot.forager.tx !== guard.forager.tx ||
      snapshot.forager.ty !== guard.forager.ty) &&
    corridorDirs(guard.board, guard.forager.tx, guard.forager.ty).length === 0
  ) {
    return {
      reason:
        `the forager left (${guard.forager.tx}, ${guard.forager.ty}), a tile ` +
        "with no corridor neighbor at all, so it went into rock",
      owner: FORAGER_CORRIDORS,
    };
  }

  return null;
}

/** What a point asks of the scene it posed. */
export interface SceneDemand {
  /** How a failure names the scenario. `"the scenario"` by default. */
  what?: string;
  /**
   * The claims this point OWNS, named as the points that own them. A break of a
   * kind listed here is this point's own finding rather than a reason to
   * decline, which is what {@link FORAGER_CORRIDORS} and
   * {@link PREDATOR_CORRIDORS} are for.
   */
  owns?: readonly string[];
}

/**
 * The scene held, or this check stands down.
 *
 * The FIRST assertion of every bystander point, in place of reading
 * {@link sceneHeld} directly:
 *
 * ```ts
 * const guard = await sceneGuard(h, quiet);
 * // ... drive the measurement ...
 * requireSceneHeld(await h.snapshot(), guard);
 * ```
 *
 * A scene that came apart for a reason another point owns is a DECLINE, naming
 * that point; one that came apart for any other reason is a FAILURE, because a
 * fault nothing else grades has to be graded here.
 */
export function requireSceneHeld(
  snapshot: SceneView,
  guard: SceneGuard,
  demand: SceneDemand = {},
): void {
  const what = demand.what ?? "the scenario";
  const broke = sceneHeld(snapshot, guard);

  // Asked FIRST, and asked whether or not the reading above found anything. A
  // body that crossed rock has taken the scenario apart whether or not the upset
  // shows in the picture the guard took: a hunter that walks out of a sealed ring
  // and stands somewhere the fixture never let it reach leaves the lives, the
  // screen and the forager's tile exactly as they were, and every measurement
  // taken around it is of a board that no longer holds.
  const owned = sceneBreakOwner(snapshot, guard, demand.owns ?? []);
  if (owned !== null) {
    unmetPrecondition(
      `Expected: ${what} to stand as it was arranged, which is what the rock ` +
        `and the den it was posed on are for — a verdict for ${owned.owner} ` +
        `to give, not this one's\nActual: ${owned.reason}` +
        (broke === null ? "" : `; and ${broke}`),
    );
  }

  if (broke !== null) fail(`${what} held to the end`, broke);
}

/**
 * Refuse to grade a scenario whose subject has left the room it was posed in.
 *
 * {@link sceneBreakOwner} reads the board at the END of a measurement, and every
 * reading it takes has to hold for the checks that re-pose their subject
 * part-way through as well, so it says nothing about where a hunter has WANDERED
 * to. This is that reading, and a check calls it for a hunter it posed once and
 * left alone: the fixture pens it into a ring, a lane or a chamber, and a route
 * from there to anywhere else crosses rock.
 *
 * Called where the check's own first assertion would otherwise fire, because a
 * hunter loose in the rock reaches the forager, takes a fix and answers that
 * assertion long before the scene guard is read.
 */
export function requirePosedGround(
  snapshot: SceneView,
  guard: SceneGuard,
  index: number,
  what: string,
): void {
  const posed = guard.posed[index];
  const at = snapshot.predators[index];
  if (posed === undefined || at === undefined) return;
  // Nothing to conclude from: the pose left it somewhere no body may stand, and
  // `controls/setmaze-houses-predators` is the point that grades that.
  if (posed.reach === null) return;
  if (posed.reach.has(tileKey(at))) return;
  failPrecondition(
    `the ${posed.kind} to stay in ${what}, which no route over corridor, den ` +
      `and gate joins to anywhere else on this fixture`,
    PREDATOR_CORRIDORS,
    `it stood at (${at.tx}, ${at.ty}), off the ` +
      `(${posed.tile.tx}, ${posed.tile.ty}) this fixture posed it on`,
  );
}

/* -------------------------------------------------------------------------- */
/* Deferring to the point that owns the claim                                 */
/* -------------------------------------------------------------------------- */

/**
 * Refuse to grade a scenario whose forager never moved.
 *
 * WHY THIS DEFERS. Plenty of points are not about movement at all — what one
 * plankton is worth, what clearing the maze pays, whether a cue sounds — but
 * reach their subject by traveling the forager into something. On a build whose
 * forager cannot move, every one of them fails on its own wording: "the forager
 * ate a plankton", "eating the last plankton clears the maze", "clearing awards
 * the bonus". One run failed nine checks that way, each blaming a different
 * mechanic, none of them the one that was broken.
 *
 * Whether the forager moves at all is `controls/move-*` and `maze-movement/*`'s
 * verdict, and they do give it.
 */
export function requireSwim(
  before: { x: number; y: number },
  after: { x: number; y: number },
  what: string,
): void {
  const moved = Math.hypot(after.x - before.x, after.y - before.y);
  if (moved >= MOTION_EPS) return;
  failPrecondition(
    `the forager to travel under a held movement action so it could ${what}; ` +
      "specs/movement.md has it travel while one is held",
    "the controls and maze-movement points",
    `${moved.toFixed(1)} units moved`,
  );
}

/**
 * The same refusal, for a scenario whose SUBJECT is a predator that never moved.
 *
 * {@link requireSwim} covers the checks that reach their subject by travelling
 * the forager. The mirror case is a check that poses a hunter and reads what it
 * does next — cross an ink cloud, round a corner, reach the tile a ping found,
 * close on the forager. Every predator in `specs/predators.md` moves under its
 * own power at a speed that page fixes, so a hunter that covers no ground at all
 * across a whole measurement has not exhibited the behavior being graded, and
 * the check cannot tell a wrong answer from no answer.
 *
 * Deliberately NOT for the points that are about a predator staying put — a
 * denned hunter, a bystander held as scenery by `setCreatureAI(false)`, a hunter
 * boxed in by rock — each of which passes a distance of zero legitimately.
 */
export function requirePredatorMotion(
  before: SceneView,
  after: SceneView,
  index: number,
  what: string,
): void {
  const from = predatorAt(before, index);
  const to = predatorAt(after, index);
  // A missing predator is the roster's verdict, not this one's.
  if (from === undefined || to === undefined) return;
  const moved = Math.hypot(to.x - from.x, to.y - from.y);
  if (moved >= MOTION_EPS) return;
  failPrecondition(
    `the ${to.kind} to travel under its own power while the scenario waited ` +
      `for it to ${what}; specs/predators.md fixes a speed for every state it ` +
      "can be in",
    "the den and patrol points",
    `${moved.toFixed(1)} units moved`,
  );
}
