// Fathom — scenario integrity. CASE-PROVIDED, and shared byte-identically by
// every engine's validator project.
//
// A Fathom check almost never watches the whole board. It watches ONE thing — a
// patrol's speed, a ping's cadence, a flare's interval, what one plankton is
// worth — while everything else is supposed to hold still around it. This module
// is what makes "supposed to" checkable, and it exists because of what happens
// when it is not.
//
// A run had its forager rested inside the ring a fixture keeps a hunter in. The
// hunter heard it and ate it. Eleven checks then reported, perfectly truthfully,
// on the hunter's speed, its silence and its flare cadence — eleven verdicts that
// were true of what happened and useless as findings, and not one of them named
// what had actually gone wrong. Another run's predators never moved a pixel, and
// ten checks reported that as ink failing to break a fix, cornering failing to
// cost speed, a lost-you ping never firing, and contact never costing a life: ten
// mechanics named, none of them the one that was broken.
//
// So there are two devices here, and they answer two different questions.
//
//   THE SCENE GUARD asks "did the situation I posed survive the measurement?"
//   A bystander check opens with {@link sceneGuard} and makes {@link sceneHeld}
//   its FIRST assertion, so a scenario that gave way names what gave way instead
//   of blaming its subject.
//
//   A PRECONDITION asks "can this build reach the scenario at all?" A forager
//   that cannot swim, a predator that never moves — those are real defects, and
//   they belong to the checks that OWN them. Everything downstream raises an
//   unmet precondition through `h.unmet` and stands aside, so the grade names the
//   one broken thing once rather than nine mechanics that were fine.
//
// IT IMPORTS ONLY `maze.ts` AND `fixtures.ts`, and describes the harness it drives
// structurally, so this module is the same file under every engine.

import {
  type BoardSnapshot,
  type PoseHarness,
  type PoseOps,
  placeForager,
  walledDir,
} from "./fixtures";
import type { Dir, TileRef } from "./maze";

/** The operations a scene helper calls beyond the ones a poser needs. */
export interface SceneOps extends PoseOps {
  reset(options?: { seed?: number }): void | Promise<void>;
  startDive(): void | Promise<void>;
}

/** A harness a scene helper can drive: a poser's, plus `reset` and `startDive`. */
export interface SceneHarness<S extends BoardSnapshot> extends PoseHarness<S> {
  readonly debug: SceneOps;
}

/* -------------------------------------------------------------------------- */
/* Reaching live play                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Reset on a stated seed, open a dive, and enter live play, through the debug
 * surface alone.
 *
 * `startDive` poses the opening of a real dive and `beginPlay` ends the countdown
 * immediately (`specs/instrumentation.md`), so this reaches live play without
 * pressing a menu key: a build with a broken title menu and correct movement must
 * fail the menu points and pass the movement ones. A check that is ABOUT the
 * menus drives them itself and never calls this.
 *
 * The seed is stated rather than defaulted so a scenario that turns on the board
 * a build laid out replays exactly.
 */
export async function startPlaying<S extends BoardSnapshot>(
  h: SceneHarness<S>,
  seed = 1,
): Promise<S> {
  await h.debug.reset({ seed });
  await h.debug.startDive();
  await h.debug.beginPlay();
  return h.snapshot();
}

/* -------------------------------------------------------------------------- */
/* Holding the rest of the board still                                        */
/* -------------------------------------------------------------------------- */

/** What {@link denAllExcept} put away, and the state it left behind. */
export interface Quiet {
  /** The predator indices posed into the den. */
  denned: number[];
  /** How each of them is named in a failure message. */
  kinds: string[];
  lives: number;
  screen: string;
}

/**
 * Pose every predator into the den except the ones named, so a check reads one
 * hunter's behavior undisturbed.
 *
 * `setPredatorState(index, "den")` returns a predator to the den, clears its
 * `released` flag and SUSPENDS its release time (`specs/instrumentation.md`), so
 * it stays there however long the scenario runs. That is what makes the rest of
 * the board quiet.
 *
 * The token it returns goes to {@link boardDisturbance} and {@link sceneGuard}, so
 * a scenario that later finds its subject somewhere unexpected can say WHICH
 * predator broke the quiet rather than blaming the one it was watching.
 */
export async function denAllExcept<S extends BoardSnapshot>(
  h: SceneHarness<S>,
  except: readonly number[] = [],
): Promise<Quiet> {
  const before = await h.snapshot();
  const denned: number[] = [];
  const kinds: string[] = [];
  for (let index = 0; index < before.predators.length; index += 1) {
    if (except.includes(index)) continue;
    await h.debug.setPredatorState(index, "den");
    denned.push(index);
    kinds.push(before.predators[index].kind);
  }
  const snap = await h.snapshot();
  return { denned, kinds, lives: snap.lives, screen: snap.screen };
}

/**
 * What broke the quiet board {@link denAllExcept} posed, as a sentence, or `null`
 * when nothing did.
 *
 * When a long-running check finds its subject somewhere unexpected, the honest
 * question is whether the SUBJECT did something or whether the scenario stopped
 * holding. A predator posed into the den and now loose has broken the
 * precondition; a life lost returns every predator to the den at once
 * (`specs/progression.md`), which drops the subject into `"den"` through no fault
 * of its own. Reported as "the subject left its wander", both of those read as a
 * finding about the subject, which is exactly the wrong diagnosis.
 */
export function boardDisturbance(
  snap: BoardSnapshot,
  quiet: Quiet | null,
): string | null {
  if (quiet === null) return null;
  if (snap.lives < quiet.lives) {
    return (
      `the forager was caught and lost a life mid-measurement, which returned ` +
      `every predator to the den` +
      (quiet.kinds.length > 0
        ? ` — and the ${quiet.kinds.join(" and ")} had been posed into the den, ` +
          `so nothing should have been loose to catch it`
        : "")
    );
  }
  const out = quiet.denned.filter(
    (index) =>
      snap.predators[index]?.state !== undefined &&
      snap.predators[index].state !== "den",
  );
  if (out.length > 0) {
    const names = out.map((index) => snap.predators[index].kind);
    return `the ${names.join(" and ")} left the den it was posed into and disturbed the scenario`;
  }
  if (snap.screen !== quiet.screen) {
    return `the dive left ${quiet.screen} for ${snap.screen} mid-measurement`;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* The scene guard                                                            */
/* -------------------------------------------------------------------------- */

/** A picture of the scenario the moment `arrange` finished with it. */
export interface SceneGuard {
  quiet: Quiet | null;
  foragerParked: boolean;
  forager: TileRef;
  lives: number;
  screen: string;
}

/**
 * Take a picture of the scenario the moment it is posed, so a check can ask
 * whether it was still standing when the measurement ended.
 *
 * Pair with {@link sceneHeld}, which is the check's FIRST assertion:
 *
 * ```ts
 * const guard = await sceneGuard(h, quiet);
 * // ... drive the measurement ...
 * const broke = sceneHeld(await h.snapshot(), guard);
 * assertNull(broke, "the scenario held to the end");
 * ```
 *
 * `foragerParked` is for a scenario in which the forager is a BYSTANDER and must
 * not wander; a check that drives the forager itself passes `false`.
 */
export async function sceneGuard<S extends BoardSnapshot>(
  h: PoseHarness<S>,
  quiet: Quiet | null = null,
  options: { foragerParked?: boolean } = {},
): Promise<SceneGuard> {
  const snap = await h.snapshot();
  return {
    quiet,
    foragerParked: options.foragerParked ?? true,
    forager: { tx: snap.forager.tx, ty: snap.forager.ty },
    lives: snap.lives,
    screen: snap.screen,
  };
}

/**
 * What gave way in the scene {@link sceneGuard} captured, as a sentence, or `null`
 * when nothing did.
 */
export function sceneHeld(
  snap: BoardSnapshot,
  guard: SceneGuard | null,
): string | null {
  if (guard === null) return null;
  const disturbed = boardDisturbance(snap, guard.quiet);
  if (disturbed !== null) return disturbed;
  if (snap.lives < guard.lives) {
    return "the forager lost a life mid-measurement, which resets the board";
  }
  if (snap.screen !== guard.screen) {
    return `the dive left ${guard.screen} for ${snap.screen} mid-measurement`;
  }
  if (guard.foragerParked) {
    const forager = snap.forager;
    if (forager.tx !== guard.forager.tx || forager.ty !== guard.forager.ty) {
      return (
        `the forager did not stay where the scenario parked it — it was at ` +
        `(${guard.forager.tx}, ${guard.forager.ty}) and ended at ` +
        `(${forager.tx}, ${forager.ty}), so what was measured is not the ` +
        `situation this check describes`
      );
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Parking a bystander forager                                                */
/* -------------------------------------------------------------------------- */

/**
 * Hold the forager still on a tile, as a BYSTANDER, for a check that reads
 * something else.
 *
 * WHY IT FACES A WALL. `specs/movement.md` and `specs/instrumentation.md` leave
 * different room here. Movement describes the arcade rule — a body "carries on
 * along its current heading while the tile ahead is open" — so a conforming build
 * may well swim on. `setForagerTile` leaves the forager "at rest there, as though
 * no movement key were held", which reads as stopped. Both are legitimate, and a
 * check must not silently require one.
 *
 * So the forager is faced INTO ROCK. Its heading leads nowhere, so it cannot
 * leave the tile under either reading, using nothing but documented operations.
 * On a build that already rests, this is a no-op beyond the facing.
 *
 * Only for a scenario where the forager's own facing does not matter; a check that
 * READS its heading poses that heading itself.
 */
export async function parkForager<S extends BoardSnapshot>(
  h: PoseHarness<S>,
  tile?: TileRef,
): Promise<S> {
  const snap = await h.snapshot();
  const where = tile ?? { tx: snap.forager.tx, ty: snap.forager.ty };
  // A crossroads has no walled side, in which case the best available is to leave
  // the facing alone: a resting build still holds, and the caller chose the tile.
  const wall: Dir | null = walledDir(snap, where);
  await placeForager(h, where, wall ?? undefined);
  return h.snapshot();
}

/**
 * Make the plankton under a just-posed forager a non-event: eat it, and put `G`
 * back to the zero a dive opens on.
 *
 * WHY A POSE NEEDS THIS. A plankton sits on every corridor tile
 * (`specs/gameplay.md`), so a forager placed anywhere is standing on one and eats
 * it on the next tick of the real simulation. One pellet is `BRIGHT_PER_EAT`,
 * which is not nothing: it widens the light pocket, and it widens the
 * Lanternjaw's and the Flarefish's reach for a second or two while it decays. A
 * check that poses the forager somewhere and then measures a range, a decay, or
 * what a hunter can see from where it stands would be measuring that pellet as
 * much as the build.
 *
 * THE TICK IS TAKEN WITH THE CREATURES' MINDS OFF. A tick of simulation is a tick
 * for everything, and several scenarios pose a predator and then read its OPENING
 * state. Handed a free tick, a hunter two tiles from the forager senses it and is
 * already chasing before the check has looked. `setCreatureAI(false)` suspends
 * exactly that initiative and nothing else (`specs/instrumentation.md`): the
 * forager still eats, which is the whole point of the tick. The minds go straight
 * back on, so a scenario that wants them off says so after this call.
 *
 * `skip` rather than `advance`, because this is setup: it must cost a captured
 * section nothing.
 */
export async function clearUnderfoot<S extends BoardSnapshot>(
  h: PoseHarness<S>,
): Promise<void> {
  await h.debug.setCreatureAI(false);
  await h.skip(1);
  await h.debug.setCreatureAI(true);
  await h.debug.setBrightness(0);
}

/**
 * Park the forager as a bystander and leave the board in a state no amount of
 * grazing can end the round from.
 *
 * THE OBVIOUS ALTERNATIVE IS THE BUG. Stripping the board to a single pellet does
 * keep a drifting forager from grazing for long — but it leaves the maze one
 * mouthful from CLEARED, with that mouthful next to the forager. A build whose
 * forager carries on to the next center ate it: the maze cleared, the dive
 * descended, every predator re-denned, and whatever the scenario was watching
 * ended mid-measurement — reported, of course, against the subject.
 *
 * So the board is left FULL instead. Nothing about a full board can end the round:
 * on a build's own maze there are hundreds of pellets, and every posed fixture
 * carries a sealed larder for the same reason. What that costs is the one pellet
 * under the forager, which {@link clearUnderfoot} settles.
 */
export async function quietBoard<S extends BoardSnapshot>(
  h: PoseHarness<S>,
  tile?: TileRef,
): Promise<S> {
  const snap = await parkForager(h, tile);
  await clearUnderfoot(h);
  return snap;
}

/* -------------------------------------------------------------------------- */
/* Preconditions                                                              */
/* -------------------------------------------------------------------------- */

/**
 * How far a body must travel before a scenario will believe it can move at all,
 * in logical units.
 *
 * An eighth of a tile: far below the tile-and-a-bit these scenarios actually
 * need, and far above the rounding of a single step.
 */
export const MOTION_EPS = 4;

/**
 * Refuse to grade a scenario whose forager never moved.
 *
 * WHY THIS IS A PRECONDITION AND NOT A VERDICT. Plenty of checks are not about
 * movement at all — what one plankton is worth, what clearing the maze pays,
 * whether a cue sounds — but reach their subject by swimming the forager into
 * something. On a build whose forager cannot move, every one of them fails on its
 * own wording: "the forager swam into a plankton", "eating the last plankton
 * clears the maze", "clearing awards the bonus". One run failed nine checks that
 * way, each blaming a different mechanic, none of them the one that was broken.
 *
 * Whether the forager moves is `controls/*` and `maze-movement/*`'s verdict to
 * give, and they do give it. Everything downstream says so and stands aside.
 */
export function requireSwim<S extends BoardSnapshot>(
  h: PoseHarness<S>,
  before: { x: number; y: number },
  after: { x: number; y: number },
  what: string,
): void {
  const moved = Math.hypot(after.x - before.x, after.y - before.y);
  if (moved >= MOTION_EPS) return;
  h.unmet(
    `the forager did not move under a held action (${moved.toFixed(1)} units), so ` +
      `it could not ${what} — whether it moves at all is the movement checks' ` +
      `verdict, not this one's`,
  );
}

/**
 * The same refusal, for a scenario whose SUBJECT is a predator that never moved.
 *
 * {@link requireSwim} covers the checks that reach their subject by swimming the
 * forager. The mirror case is a check that poses a hunter and reads what it does
 * next — cross an ink cloud, round a corner, reach the tile a ping found, close on
 * the forager. Every predator in `specs/predators.md` moves under its own power at
 * a speed that page fixes, so a hunter that covers no ground at all across a whole
 * measurement has not exhibited the behavior being graded, and the check cannot
 * tell a wrong answer from no answer.
 *
 * Deliberately NOT for a check that is ABOUT a predator staying put — a denned
 * hunter, a bystander held as scenery by `setCreatureAI(false)`, a hunter boxed in
 * by rock — each of which passes a distance of zero legitimately.
 */
export function requirePredatorMotion<S extends BoardSnapshot>(
  h: PoseHarness<S>,
  before: BoardSnapshot,
  after: BoardSnapshot,
  index: number,
  what: string,
): void {
  const from = before.predators[index];
  const to = after.predators[index];
  // A missing predator is the roster's verdict, not this one's.
  if (from === undefined || to === undefined) return;
  const moved = Math.hypot(to.x - from.x, to.y - from.y);
  if (moved >= MOTION_EPS) return;
  h.unmet(
    `the ${from.kind} did not move at all (${moved.toFixed(1)} units) while the ` +
      `scenario waited for it to ${what} — whether a predator moves under its own ` +
      `power is the den and patrol checks' verdict, not this one's`,
  );
}
