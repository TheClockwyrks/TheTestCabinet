// Fathom — scenario integrity. CASE-PROVIDED, and SHARED BYTE-IDENTICALLY across
// `validation/none/`, `validation/simple-2d/` and `validation/structured-2d/`.
//
// Most points in this suite are about ONE thing while several others are held
// still around it: a hunter posed into the den stays there, the forager stands
// where it was parked, nobody is caught, the dive does not restart. When one of
// those gives way, what was measured is a different situation from the one the
// point describes — and, left unguarded, it is reported against the SUBJECT. A
// run had its forager rested in the ring a fixture keeps a hunter in; the hunter
// heard it and ate it, and eleven checks reported the hunter's speed, its
// silence, its flare cadence. Every one of those verdicts was true of what
// happened and useless as a finding.
//
// This module is the answer to that, and it has two halves.
//
// 1. A SCENARIO REPORTS ITS OWN UPSETS. {@link sceneGuard} takes a picture of the
//    arrangement the moment it finished, and {@link requireScene} asks whether
//    that picture still held when the measurement ended, so a broken scenario
//    names what gave way instead of blaming its subject.
//
// 2. A PRECONDITION IS NOT A VERDICT. Some claims this suite rests on have a
//    point of their own that FAILS for them, and a check that merely stood on one
//    has nothing to say about a build that broke it. Those checks DECLINE:
//    {@link unmetPrecondition} raises the reason, and {@link check} — the form
//    every point in this suite declares its test in — turns it into a skipped
//    check, which the runner reads as one that decided nothing. A verdict of
//    "wrong" from a check that never reached its subject is worse than no verdict
//    at all: one run failed nine mechanics because a single build's forager could
//    not swim, and every one of those findings was true and useless.
//
// WHICH CLAIMS HAVE AN OWNER, AND WHO OWNS THEM. `maze-movement/no-wall` owns the
// forager keeping to the corridors and `maze-movement/predators-keep-to-corridors`
// owns the hunters doing the same, so a scene that came apart because a body
// crossed rock is a decline everywhere else — that is what
// {@link requireScene} decides. `controls/setmaze-houses-predators` owns a pose
// putting every hunter away and holding it there, so a hunter this scenario
// denned that reports itself released and swims out is a decline too, and so is a
// posed board `setMaze` left one standing loose on (`fixtures.ts`). `controls/*` and
// `maze-movement/*` own the forager travelling at all ({@link requireSwim}), the
// den and patrol points own a predator travelling at all
// ({@link requirePredatorMotion}), and `scoring/depth-scaling` owns what the
// roster carries ({@link requireKind}). A scene that came apart for a reason
// NOTHING else owns still FAILS, because otherwise the fault goes ungraded.
//
// Like `fixtures.ts` and `maze.ts` it names the operations it drives as an
// interface of its own rather than importing a `surface.ts`, which is what lets
// all three engine directories carry the same file.

import { it, type TestContext } from "vitest";
import { fail } from "./assert";
import {
  faceWall,
  placeForager,
  type Awaitable,
  type FixtureHost,
  type PredatorPose,
} from "./fixtures";
import type { BoardView, Dir, Tile } from "./maze";

/** The forager, as much of it as a scenario guard reads. */
export interface ForagerView {
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: string;
  moving: boolean;
}

/** One predator, as much of it as a scenario guard reads. */
export interface PredatorView extends PredatorPose {
  x: number;
  y: number;
}

/** The board and the run, as much of both as this module reads. */
export interface SceneView extends BoardView {
  screen: string;
  lives: number;
  planktonRemaining: number;
  brightness: number;
  forager: ForagerView;
  predators: readonly PredatorView[];
}

/** The operations this module drives. */
export interface SceneOps {
  setPredatorState(
    index: number,
    value: "den" | "wander" | "chase",
  ): Awaitable<void>;
  setCreatureAI(enabled: boolean): Awaitable<void>;
  setBrightness(g: number): Awaitable<void>;
  setForagerTile(tx: number, ty: number): Awaitable<void>;
  setForagerDir(dir: Dir): Awaitable<void>;
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
 * specs/movement.md confines every body to the tiles open to it — the forager to
 * corridor, a predator to corridor and, while it is in the den, the chamber and
 * its gate — so a body whose reported tile is rock or off the board did not get
 * there by travelling. A harness samples for this as it advances, because the
 * evidence does not survive: a hunter that walks through rock, eats the forager
 * and is returned to the den by the life it cost stands on a den tile by the time
 * the check looks.
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
 * find it there for as long as it runs: specs/instrumentation.md returns it to a
 * den tile with `released` false and SUSPENDS its release time, so no release
 * time arrives while the pose stands. A build that grants it anyway walks the
 * hunter out through the gate and into whatever was being measured.
 *
 * THE READING IS THE FLAG, NOT THE DEPARTURE, for two reasons. It is the fact
 * `controls/setmaze-houses-predators` decides — that point watches a posed den and
 * asserts that none of its hunters reports `released` — so it is the fact the
 * decline should name. And the departure itself can pass between two of the
 * harness's own looks: a hunter one tile from the gate steps onto the corridor and
 * onto the forager inside a single tick, and the life it takes returns every
 * hunter to the den, so by the time the check looks nothing is out of place at all.
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
  readonly debug: SceneOps & FixtureHost["debug"];
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
  snapshot(): Awaitable<SceneView>;
  advance(frames: number): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* Reading the roster                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The predator at `index` of the roster, or `undefined` where the roster is
 * shorter than that.
 *
 * specs/state.md lists the roster in release order and fixes one stable index per
 * predator for as long as that roster stands, which is the index every predator
 * operation selects by. A missing entry is the roster's own verdict
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

/* -------------------------------------------------------------------------- */
/* Quieting the board                                                         */
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
 * Pose every predator into the den except the ones at `except`.
 *
 * specs/instrumentation.md has `setPredatorState(index, "den")` return the
 * predator to a den tile, clear its `released` flag and SUSPEND its release time,
 * so it stays in the chamber for as long as the scenario runs. That is what makes
 * the rest of the board quiet while one predator is read.
 *
 * The token it returns is what lets a scenario that later finds its subject in an
 * unexpected state say WHICH predator broke the quiet, rather than blaming the one
 * it was watching.
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
 * Make the plankton under a just-placed forager a non-event: eat it, and put `G`
 * back to the zero a dive opens on.
 *
 * WHY A POSE NEEDS THIS. A maze carries a plankton on every corridor tile
 * (specs/gameplay.md), so a forager placed anywhere is standing on one and eats it
 * on the next tick of the real simulation. One pellet is `BRIGHT_PER_EAT` (`0.34`)
 * of brightness, which is not nothing: it widens the light pocket, and it widens
 * the Lanternjaw's and the Flarefish's reach by `65` units for a second or two
 * while it decays. A scenario that places the forager somewhere and then measures a
 * range, a decay, or what a hunter can see from where it stands would be measuring
 * that pellet as much as the build.
 *
 * THE TICK IS TAKEN WITH THE CREATURES' MINDS OFF. A tick of simulation is a tick
 * for everything, and several scenarios pose a predator and then read its OPENING
 * state. Handed a free tick, a hunter two tiles from the forager senses it and is
 * already chasing before the check has looked. `setCreatureAI` suspends exactly
 * that initiative and nothing else (specs/instrumentation.md): the forager still
 * eats, which is the whole point of the tick. It is restored immediately.
 *
 * A scenario that wants the minds off for its own reasons says so after this call.
 */
export async function clearUnderfoot(h: SceneHost): Promise<void> {
  await h.debug.setCreatureAI(false);
  await h.advance(1);
  await h.debug.setCreatureAI(true);
  await h.debug.setBrightness(0);
}

/**
 * Hold the forager still on a tile, as a BYSTANDER, for a scenario that reads
 * something else.
 *
 * specs/movement.md has the forager travel while a movement action is held and
 * come to rest where it stands when none is, and a forager at rest takes its
 * desired direction only when the tile that way is open to it. So a bystander is
 * held by its FACING: pointed at rock, its heading leads nowhere and it cannot
 * leave the tile, using nothing but the documented operations.
 *
 * `tile` defaults to wherever the forager already stands. Only for a scenario
 * where the forager's own facing does not matter; a check that reads its heading
 * poses that heading itself.
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
 * THE BOARD IS LEFT FULL, DELIBERATELY. Stripping it to a single pellet does keep
 * a bystander from grazing for long, but it leaves the maze one mouthful from
 * CLEARED, with that mouthful next to the forager: a build whose forager travels
 * on eats it, the maze clears, the dive descends, every predator is re-denned, and
 * whatever the scenario was watching ends mid-measurement. A full board can end no
 * round — a generated maze carries hundreds of pellets, and every posed fixture
 * carries a sealed larder for the same reason. What that costs is the one pellet
 * under the forager, which {@link clearUnderfoot} settles.
 */
export async function quietBoard(h: SceneHost, tile?: Tile): Promise<void> {
  await parkForager(h, tile);
  await clearUnderfoot(h);
}

/* -------------------------------------------------------------------------- */
/* The scenario reports its own upsets                                        */
/* -------------------------------------------------------------------------- */

/** The picture {@link sceneGuard} took, for {@link sceneHeld} to judge against. */
export interface SceneGuard {
  quiet: Quiet | null;
  foragerParked: boolean;
  forager: Tile;
  lives: number;
  screen: string;
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
 * Pair with {@link sceneHeld}. `quiet` is {@link denAll}'s token, where the
 * scenario posed one; `foragerParked` says the forager is a bystander and must not
 * wander.
 */
export async function sceneGuard(
  h: SceneHost,
  quiet: Quiet | null = null,
  options: { foragerParked?: boolean } = {},
): Promise<SceneGuard> {
  const snapshot = await h.snapshot();
  return {
    quiet,
    foragerParked: options.foragerParked ?? true,
    forager: { tx: snapshot.forager.tx, ty: snapshot.forager.ty },
    lives: snapshot.lives,
    screen: snapshot.screen,
    trespasses: h.trespasses,
    trespassMark: h.trespasses.length,
    denReleases: h.denReleases,
    denReleaseMark: h.denReleases.length,
  };
}

/**
 * What broke the quiet board {@link denAll} posed, as a sentence, or `null` when
 * nothing did.
 *
 * A predator posed into the den and now loose has broken the precondition; a life
 * lost returns every predator to the den at once, which drops the subject into
 * `"den"` through no fault of its own. Reported as "the subject left its wander",
 * both of those read as a finding about the subject, which is exactly the wrong
 * diagnosis.
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
    return `the ${out.map((one) => one.kind).join(" and ")} left the den it was posed into and disturbed the scenario`;
  }
  if (snapshot.screen !== quiet.screen) {
    return `the dive left ${quiet.screen} for ${snapshot.screen} mid-measurement`;
  }
  return null;
}

/**
 * What broke the scene {@link sceneGuard} captured, as a sentence, or `null` when
 * nothing did.
 *
 * {@link requireScene} is what a bystander point calls; this is the reading it
 * takes, exported for the two points that OWN a body keeping to the corridors,
 * which report a scene break as their own finding rather than declining on it.
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
        `(${guard.forager.tx}, ${guard.forager.ty}) and ended at (${at.tx}, ${at.ty}), ` +
        "so what was measured is not the situation this point describes"
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

/**
 * The point that owns the reason this scene came apart, or `null` where nothing
 * does.
 *
 * There are two kinds of upset with an owner. A body that crossed rock, and a
 * hunter this scenario posed into the den that reported itself released and swam
 * out of it.
 *
 * THE FIRST.
 * Every fixture in this suite holds its scenario together with rock — a bystander
 * walled off from its subject, a pair sealed into neighboring cells, a hunter in a
 * sealed ring, a den walled on three sides — so a body that ignores rock takes
 * every one of those apart at once, and a suite that reported each of them against
 * its own subject would name fifty mechanics for one fault.
 * `maze-movement/no-wall` and `maze-movement/predators-keep-to-corridors` are the
 * points that fail for it, and they read the tiles a body stands on directly
 * rather than through this.
 *
 * THE SECOND. `denAll` puts the rest of the roster away, and
 * specs/instrumentation.md suspends the release time of every hunter a pose dens,
 * so nothing is due to come out while a scenario runs. A build that grants one
 * anyway walks a hunter out through the gate and into whatever was being measured,
 * and `controls/setmaze-houses-predators` is the point that fails for it: it
 * watches a posed den past the time the third hunter would ordinarily be due and
 * asserts that none of them reports `released`. That flag is what the attribution
 * turns on, because it is exactly the fact that point decides.
 *
 * Everything else — a life lost with every hunter accounted for, a maze cleared
 * mid-measurement, a forager that would not stay parked — has no other point
 * standing behind it, so {@link requireScene} FAILS for those rather than letting
 * the fault go ungraded.
 */
export function sceneBreachOwner(
  guard: SceneGuard,
  owns: readonly string[] = [],
): string | null {
  const stepped = trespassesSince(guard).filter(
    (one) => !owns.includes(one.owner),
  );
  if (stepped.length > 0) {
    const owners = [...new Set(stepped.map((one) => one.owner))];
    return (
      `${stepped.map((one) => one.where).join("; ")} — specs/movement.md ` +
      "confines every body to the tiles open to it, and a body that crosses " +
      "rock takes apart the rock this scenario is held together by; a verdict " +
      `for ${owners.join(" and ")} to give, not this one's`
    );
  }

  const posed = guard.quiet?.denned ?? [];
  const granted = guard.denReleases
    .slice(guard.denReleaseMark)
    .filter((one) => posed.some((denned) => denned.index === one.index));
  if (granted.length > 0 && !owns.includes(HOUSED_PREDATORS)) {
    return (
      `${granted.map((one) => one.where).join("; ")} — a pose that dens a ` +
      "hunter suspends its release time (specs/instrumentation.md), so no " +
      "release time arrives while this scenario stands, and a hunter granted " +
      `one anyway comes out through the gate; a verdict for ${HOUSED_PREDATORS} ` +
      "to give, not this one's"
    );
  }

  return null;
}

/** What a point asks of the scene it posed. */
export interface SceneDemand {
  /** How a failure names the scenario. `"the scenario"` by default. */
  what?: string;
  /**
   * The claims this point OWNS, named as the points that own them. A trespass of
   * a kind listed here is this point's own finding rather than a reason to
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
 * requireScene(h.snapshot(), guard);
 * ```
 *
 * A scene that came apart for a reason another point owns is a DECLINE, naming
 * that point; one that came apart for any other reason is a FAILURE, because a
 * fault nothing else grades has to be graded here.
 */
export function requireScene(
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
  const owner = sceneBreachOwner(guard, demand.owns ?? []);
  if (owner !== null) {
    unmetPrecondition(
      `Expected: ${what} to stand as it was arranged, which is what the rock ` +
        `and the den it was posed on are for\nActual: ${owner}` +
        (broke === null ? "" : `; and ${broke}`),
    );
  }

  if (broke !== null) fail(`${what} held to the end`, broke);
}

/* -------------------------------------------------------------------------- */
/* Deferring to the point that owns the claim                                 */
/* -------------------------------------------------------------------------- */

/**
 * How far a body must travel before a scenario will believe it can move at all,
 * in logical units.
 *
 * An eighth of a tile: far below the tile-and-a-bit these scenarios actually need,
 * and far above the rounding of a single step.
 */
export const MOTION_EPS = 4;

/**
 * The scenario a check needed could not be brought about against this build.
 *
 * This is not a verdict. The claim it stands on has a point of its own that fails
 * for it, and a check that merely passed through the broken behavior on its way
 * somewhere else has nothing to say about it.
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
 * vitest's `it`, because a check has three outcomes here and `it` gives two. An
 * {@link PreconditionUnmet} raised anywhere inside becomes `ctx.skip`, which the
 * runner reads as a check that DECIDED NOTHING; everything else — every assertion,
 * every error out of the build — travels on untouched, so nothing here can turn a
 * failing check into a passing one.
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
 * Refuse to grade a scenario whose forager never moved.
 *
 * WHY THIS DEFERS. Plenty of points are not about movement at all — what one
 * plankton is worth, what clearing the maze pays, whether a cue sounds — but reach
 * their subject by traveling the forager into something. On a build whose forager
 * cannot move, every one of them fails on its own wording: "the forager ate a
 * plankton", "eating the last plankton clears the maze", "clearing awards the
 * bonus". One run failed nine checks that way, each blaming a different mechanic,
 * none of them the one that was broken.
 *
 * Whether the forager moves at all is `controls/move-*` and `maze-movement/*`'s
 * verdict, and they do give it.
 */
export function requireSwim(
  before: ForagerView,
  after: ForagerView,
  what: string,
): void {
  const moved = Math.hypot(after.x - before.x, after.y - before.y);
  if (moved >= MOTION_EPS) return;
  failPrecondition(
    `the forager to travel under a held movement action so it could ${what}; ` +
      "specs/movement.md has it travel at FORAGER_SPEED (128) while one is held",
    "the controls and maze-movement points",
    `${moved.toFixed(1)} units moved`,
  );
}

/**
 * The same refusal, for a scenario whose SUBJECT is a predator that never moved.
 *
 * Every predator in specs/predators.md moves under its own power at a speed that
 * file fixes, so a hunter that covers no ground at all across a whole measurement
 * has not exhibited the behavior being graded, and the check cannot tell a wrong
 * answer from no answer. One build's predators never moved a pixel, and ten points
 * reported it as ink failing to break a fix, cornering failing to cost speed, a
 * lost-you ping never firing, and contact never costing a life.
 *
 * Deliberately NOT for the points that are about a predator staying put — a denned
 * hunter, a bystander held as scenery by `setCreatureAI(false)` — which pass a
 * distance of zero legitimately. It is for a scenario that asked one to travel.
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

/**
 * The same refusal, for a reason that does not decompose into a requirement and
 * an owner.
 *
 * {@link failPrecondition} is the preferred shape, because a reader of the
 * `Expected:` line alone learns which point owes the verdict. Some deferrals do
 * not split that cleanly — a fixture that could not be stamped, a hunter that
 * never left the den, a roster that arrived empty — and their reason is one
 * sentence that already names its owner. This is that sentence, declined the same
 * way and with the same consequence: the check decides nothing, and the point it
 * names decides instead.
 */
export function standDown(reason: string): never {
  return unmetPrecondition(
    `Expected: a scenario this check could grade\nActual: ${reason}`,
  );
}

/**
 * The roster index of the first predator of `kind`, or a refusal naming the point
 * that owns a roster too short to hold it.
 *
 * `specs/predators.md` puts one of each kind in the den at depth `1` and
 * `specs/state.md` lists the roster in release order, so at the depth every posed
 * scenario runs at, a kind names exactly one predator. A roster that does not
 * carry it is `scoring/depth-scaling`'s verdict rather than any posing point's.
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
