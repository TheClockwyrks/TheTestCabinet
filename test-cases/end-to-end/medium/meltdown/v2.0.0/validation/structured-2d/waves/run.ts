// Meltdown — waves/run: how this group opens a run and reaches the transitions
// its points are about. GROUP-LOCAL.
//
// THIS FILE FIXES ARRANGEMENT ALONE. Not one figure a point asserts and not one
// tolerance is decided here; every point states its own beside the figure
// `specs/waves.md` fixes for it. What lives here is the posing several points in
// this group would otherwise write out again, and the two constants below that
// say WHERE something stands or HOW LONG a drive runs — geometry, never a bound
// a build may miss a figure by.
//
// WHY THE TRANSITIONS ARE REACHED RATHER THAN POSED. `setScreen` and `setPhase`
// "set that field alone and run no entry effect" (`specs/instrumentation.md`),
// so a phase change cannot be posed into existence: the wave-clear bonus, the
// interest, the victory screen and the game-over screen all belong to the frame
// that resolves the event. Every point in this group whose requirement IS such a
// transition therefore reaches it the way the run reaches it — a unit dying, a
// unit leaking, a timer running out, a send — and the three arrangements that
// reach those live here.
//
// THE TWO WAYS A WAVE CLEARS ARE BOTH HERE, and that is deliberate:
// `specs/waves.md` clears a wave "on the frame in which its last live unit dies
// or leaks with none of it left to release", and this group carries one point
// for each. A leak needs no tower and no combat, so it is what every point that
// merely needs a clear uses; the kill is used by the one point whose requirement
// is the death.
//
// Local to this group on purpose. The `economy` and `modes` groups reach the
// same events for figures of their own and keep their arrangements beside their
// own points; nothing here belongs in the shared harness.

import { fail } from "../assert";
import { BINDINGS, COLS, DIFFICULTIES, RIGHT_EXHAUST_ROWS } from "../constants";
import {
  heatGain,
  poseTarget,
  posePinnedTower,
  poseWalker,
  ticksFor,
  tileCenter,
  travelOf,
  type ClockWindow,
  type Harness,
  type MeltdownSnapshot,
} from "../harness";

/* ---- Opening a run the way the game opens one ---------------------------- */

/**
 * The row of the difficulty menu that is Medium, from the case's own list.
 *
 * `specs/screens.md` draws `DIFFICULTY_ITEMS` in order and `specs/controls.md`
 * moves the highlight over those rows, so the row a difficulty sits on is the
 * index of that difficulty in the seeded table rather than a number written out
 * here.
 */
export const MEDIUM_ROW = DIFFICULTIES.indexOf("medium");

/**
 * Open a fresh Containment Medium run THE WAY A PLAYER OPENS ONE: from the
 * difficulty menu, by confirming a row.
 *
 * The two points that use this are about what happens on the frame a run BEGINS
 * — the wave it opens on, and the money it opens with — and a beginning is an
 * entry effect, which `setScreen` and `setPhase` run none of
 * (`specs/instrumentation.md`). So the screen and the highlighted row are posed,
 * and the CONFIRM is real: it is pressed through the key `specs/controls.md`
 * binds the action to, and the run the build opens from it is the build's own.
 *
 * Only the confirm is real, so only the confirm is depended on. Nothing here
 * walks the title and mode menus to reach the difficulty screen;
 * `specs/screens.md`'s own points decide those, and a point in this group that
 * walked them would fail whenever any row of any menu was wrong.
 *
 * Containment Medium because `specs/modes.md` gives it `interest` `yes`: it is
 * the pair on which a run that wrongly paid interest as it opened would show it.
 */
export async function openRun(h: Harness): Promise<void> {
  h.debug.reset();
  h.debug.setScreen("difficultyselect");
  h.debug.setMenuIndex(MEDIUM_ROW);
  await h.tap(BINDINGS.confirm[0]);
}

/* ---- The walker every clock point measures ------------------------------- */

/**
 * The tile a walking Mote is posed on: early in the left vent's own corridor.
 *
 * `specs/floor.md` puts the left vent on rows `16` through `19` and the right
 * exhaust on the same rows, and `specs/mazing.md` assigns a left-vent unit the
 * right exhaust for its whole life, so an empty floor routes a unit standing
 * here STRAIGHT east along one row. That is what lets a point read travel as the
 * distance between two snapshots and know it is reading distance walked: a route
 * that bent would make the second half of a window shorter than the first
 * through geometry rather than through the clock.
 *
 * Column `2` leaves better than forty tiles of open row ahead, so no window any
 * point in this group spends carries the unit near its exhaust.
 */
export const WALK_TILE = { col: 2, row: RIGHT_EXHAUST_ROWS[0] } as const;

/**
 * A Mote walking east along an open row under its own power, and its id.
 *
 * The Mote because `specs/surge.md` makes it the baseline unit and gives it a
 * speed of `60` logical units per second, which is the figure every travel floor
 * in this group is derived from. Its motion is on and nothing else about it is
 * touched, so the walk is the game's own; its position is posed so the row it
 * walks is the straight one whatever tile the vent's entry put it on.
 */
export function poseMote(h: Harness): number {
  const id = poseWalker(h, "mote", "left");
  const at = tileCenter(WALK_TILE.col, WALK_TILE.row);
  h.debug.setUnitPosition(id, at.x, at.y);
  return id;
}

/* ---- The clear, reached by a leak ---------------------------------------- */

/**
 * The tile a leaker is posed on: one tile short of the right exhaust, on a row
 * the opening covers.
 *
 * `specs/floor.md` puts the right exhaust on tiles `(49, 16)` through
 * `(49, 19)`, and a unit entering at the left vent is assigned that exhaust for
 * its whole life. So a walker posed here has one tile left to travel and reaches
 * its exhaust in a fraction of a second, which keeps a point about a transition
 * from spending its window on a walk across the floor that `specs/mazing.md`
 * already decides.
 */
export const LEAK_TILE = {
  col: COLS - 2,
  row: RIGHT_EXHAUST_ROWS[1],
} as const;

/**
 * How long a leak is waited for: three seconds of game time.
 *
 * Geometry rather than a tolerance — it says how long the drive runs, not how
 * far a build may miss a figure by. A Mote's specified `60` logical units per
 * second covers the one `TILE` (`19`) it has left in about a third of a second,
 * so three seconds carries a build walking at a ninth of that speed out through
 * the opening, and what these points read rests on the unit reaching its exhaust
 * rather than on how fast it got there.
 */
export const LEAK_TICKS = ticksFor(3);

/**
 * A Mote walking under its own power with one tile left to its exhaust, and its
 * id.
 *
 * Nothing is posed beyond the entry and the position: its motion is on, and its
 * route is recomputed from the tile the position falls in
 * (`specs/instrumentation.md`), so the walk out is the game's own.
 */
export function poseLeaker(h: Harness): number {
  const id = poseWalker(h, "mote", "left");
  const at = tileCenter(LEAK_TILE.col, LEAK_TILE.row);
  h.debug.setUnitPosition(id, at.x, at.y);
  return id;
}

/** Run until the floor is empty of surge, and say whether it emptied. */
export async function runUntilGone(h: Harness): Promise<boolean> {
  const swept = await h.until((snapshot) => snapshot.surge.length === 0, {
    maxFrames: LEAK_TICKS,
    poll: 2,
  });
  return swept.hit;
}

/* ---- The clear, reached by a kill ---------------------------------------- */

/** The gun's footprint top-left: open floor, well clear of every opening. */
export const GUN = { col: 20, row: 10 } as const;

/**
 * The tile the mark stands on: three tiles right of the gun's anchor, so it is
 * off the footprint and comfortably inside the Arc's `6.0`-tile range measured
 * from the footprint's centre (`specs/combat.md`).
 */
export const MARK = { col: 23, row: 10 } as const;

/**
 * The hp the mark is posed with: the least a live unit can carry.
 *
 * A death is what these points reach, and the smallest possible target is what
 * makes it follow from a shot landing at all rather than from any figure
 * `specs/combat.md` gives the shot. `specs/combat.md`'s "a unit at `0` hp is
 * removed on that frame" is what turns one shot into the death.
 */
export const MARK_HP = 1;

/**
 * How long a kill is waited for: six seconds of game time.
 *
 * Geometry, not a tolerance. An Arc at its specified `2.0` shots per second
 * lands its first shot half a second in (`specs/combat.md`), so six seconds is a
 * dozen intervals: a build whose fire rate or per-shot damage is off still
 * removes a single hp inside the window.
 */
export const KILL_TICKS = ticksFor(6);

/**
 * An Arc at `GUN` whose guns run and whose heat cannot move, and its id.
 *
 * `setTowerThermal(id, false)` holds the tower's part in the heat model while it
 * goes on acquiring targets and firing at its rate
 * (`specs/instrumentation.md`), so no trip can interrupt the drive and nothing
 * about heat enters a point that is about the run.
 */
export function poseGun(h: Harness): number {
  return posePinnedTower(h, "arc", GUN.col, GUN.row, 0);
}

/**
 * A Mote of one hp on `MARK`, holding its tile, and its id.
 *
 * Motion off is what keeps the reading unambiguous: the mark cannot walk out of
 * the gun's range, and it cannot reach an exhaust and LEAK instead of dying,
 * which is a different transition entirely and one this group carries its own
 * point for.
 */
export function poseMark(h: Harness): number {
  return poseTarget(h, "mote", MARK.col, MARK.row, MARK_HP);
}

/** Run until the mark is gone from the roster, and say whether it went. */
export async function runUntilKilled(h: Harness): Promise<boolean> {
  const swept = await h.until((snapshot) => snapshot.surge.length === 0, {
    maxFrames: KILL_TICKS,
    poll: 4,
  });
  return swept.hit;
}

/* ---- The end of a wave --------------------------------------------------- */

/**
 * Pose the end of wave `wave`: the wave phase, on that wave, with nothing left
 * to release.
 *
 * The shape a clear is reached from. `specs/waves.md` clears a wave on the frame
 * its last live unit goes "with none of it left to release", so `wavePending` is
 * `0` and the one unit the caller poses is the wave's last. The phase is posed
 * rather than reached because `setPhase` runs no entry effect: it is the
 * precondition, and the CLEAR is what the drive then reaches through the game's
 * own transition.
 *
 * It poses no unit. A caller adds exactly the one whose going clears the wave.
 */
export function poseWaveEnd(h: Harness, wave: number): void {
  h.debug.setWave(wave);
  h.debug.setPhase("wave");
  h.debug.setWavePending(0);
}

/* ---- Reading a window ----------------------------------------------------- */

/**
 * How far the unit `id` travelled across `span`, in logical units, failing the
 * check where the unit was missing from either end of it.
 *
 * `harness.ts`'s `travelOf` answers `null` rather than `0` there, because a unit
 * that left the floor and a unit that stood still are different outcomes; this
 * turns the first of them into a named failure so a build that lost the walker —
 * one that restarted the run rather than resuming it, say — is graded on losing
 * it rather than on a distance nobody could measure.
 *
 * It decides nothing else: how far the unit had to travel is the caller's own
 * figure.
 */
export function travelled(span: ClockWindow, id: number, leg: string): number {
  const travel = travelOf(span, id);
  if (travel === null) {
    fail(`the unit on the floor at both ends of the ${leg}`, "it was gone");
  }
  return travel;
}

/**
 * How much the tower `id`'s heat moved across `span`, failing the check where
 * the tower was missing from either end of it, for the same reason.
 */
export function heatMoved(span: ClockWindow, id: number, leg: string): number {
  const moved = heatGain(span, id);
  if (moved === null) {
    fail(`the tower on the floor at both ends of the ${leg}`, "it was gone");
  }
  return moved;
}

/* ---- Watching a long stretch --------------------------------------------- */

/**
 * Advance `ticks` frames, reading `watch` off the snapshot every `poll` frames,
 * and hand back every reading in order.
 *
 * Several points here are about something that must HOLD over a stretch rather
 * than about a value at an instant — the opening phase never starting, the wave
 * number holding through a build phase, lives never rising — and a reading taken
 * only at the end would miss a build that moved and moved back. The first
 * reading is taken before any frame runs, so the list opens with the state the
 * caller posed.
 *
 * It decides nothing: the caller says what to read and what the readings must
 * be.
 */
export async function watchOver<T>(
  h: Harness,
  ticks: number,
  poll: number,
  watch: (snapshot: MeltdownSnapshot) => T,
): Promise<T[]> {
  const readings: T[] = [watch(h.snapshot())];
  let frames = 0;
  while (frames < ticks) {
    const step = Math.min(poll, ticks - frames);
    await h.advance(step);
    frames += step;
    readings.push(watch(h.snapshot()));
  }
  return readings;
}
