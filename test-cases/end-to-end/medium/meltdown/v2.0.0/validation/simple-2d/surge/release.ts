// surge/release — how the wave points reach a wave the RUN releases, and nothing
// about what any wave carries. CASE-PROVIDED.
//
// Seven points in this group are about the progression rather than about a unit:
// which type a wave fields, how many it releases, how fast they arrive, which vent
// each is drawn to, and which tile it appears on. Every one of them has to read a
// wave the GAME released, not units a check added — `addUnit` takes the type and
// the vent as arguments, so a floor posed that way could not answer any of these
// questions. So each of them turns the world gate on, sends, and watches.
//
// THE SEND IS THE TRANSITION, AND IT IS WHY NOTHING HERE POSES THE `wave` PHASE.
// specs/waves.md says a wave releases its first unit "on the frame the wave
// begins", and specs/instrumentation.md says `setPhase` "sets that field alone and
// runs no entry effect". A posed `wave` phase is therefore a phase that never
// began, and the cadence and the size would be read against a spawner nobody
// started. `send` is the game's own way in — specs/waves.md: "Sending is what
// begins Wave 1", and it "starts the wave earlier" from a build phase — and
// specs/controls.md binds it to `Space`, so the wave begins the way a player
// begins it.
//
// THIS FILE FIXES ARRANGEMENT ALONE. Not one figure a point asserts and not one
// tolerance is decided here. The durations below say how long a watch runs, which
// is geometry: each is derived from the wave's own stated size at the stated
// cadence, with room to spare for a build that is slower than the specification.
//
// Local to this group on purpose. The `waves` group is about the phases
// themselves; nothing outside `surge/` watches what a release carries.

import { WAVE_SPAWN_INTERVAL, waveSize, waveType } from "../constants";
import {
  startRun,
  ticksFor,
  waveCountOf,
  type DifficultyName,
  type Harness,
  type MeltdownSnapshot,
  type ModeName,
  type SurgeType,
  type VentName,
} from "../harness";

/**
 * The lives a watched run is posed with: far more than any wave can take.
 *
 * A wave of forty units released against an empty floor leaks every one of them,
 * and the twenty lives a Containment run opens with would reach `0` part way
 * through — which ends the run at once, whatever the phase (specs/waves.md), and
 * stops the release these points are watching. `setLives` "triggers no game over:
 * this is a precondition" (specs/instrumentation.md), so posing a ceiling nothing
 * can reach is how the watch sees the whole wave. It asserts nothing about lives;
 * the leak points read those, on a floor of one unit.
 */
const WATCHED_LIVES = 10_000;

/** One unit as the run released it, read on the first frame it was seen. */
export interface Release {
  id: number;
  type: SurgeType;
  vent: VentName;
  /** The tile its centre fell in, as the build reported it. */
  col: number;
  row: number;
  /** Its centre, in logical stage units. */
  x: number;
  y: number;
  /** The simulation time at the end of the frame it was first seen, in seconds. */
  at: number;
}

/** How a watch is bounded, and how finely it samples. */
export interface WatchOptions {
  /** Frames between samples. `1` for a point that reads WHEN a unit arrived. */
  poll?: number;
  /** Seconds of game time the watch may run before it gives up. */
  seconds?: number;
  /**
   * Stop once this many units have been seen, rather than watching the wave out.
   *
   * For a point that reads the FRONT of a wave — which type it fields, how far
   * apart the first arrivals are — and has no business waiting for a release it
   * is not going to read.
   */
  stopAfter?: number;
}

/**
 * Open a run of `mode` at `difficulty` on wave `wave`, in a build phase, with the
 * run's own release of surge turned back on.
 *
 * `startRun` leaves an empty, quiet floor in a build phase of Wave 1
 * (harness.ts). Three things change: the wave number, the lives ceiling above,
 * and the world gate. Turning the gate on is the exception `startRun` names, and
 * these are the points whose requirement the gate IS — what the run releases
 * (specs/instrumentation.md).
 *
 * It poses and returns; it runs no frame, and it sends nothing.
 */
export function poseWaveReady(
  h: Harness,
  wave: number,
  mode: ModeName = "containment",
  difficulty: DifficultyName = "medium",
): void {
  // `startRun` resets the game first, so the vent pose is `null` and every vent
  // is the release's own draw unless the check poses one (specs/instrumentation.md).
  startRun(h, mode, difficulty);
  h.debug.setWave(wave);
  h.debug.setLives(WATCHED_LIVES);
  h.debug.setWaveSpawning(true);
}

/**
 * The wave count `specs/modes.md` gives this pair, which is the `n` every closed
 * form in `specs/waves.md` is written against.
 */
export function wavesIn(
  mode: ModeName = "containment",
  difficulty: DifficultyName = "medium",
): number {
  return waveCountOf(mode, difficulty);
}

/** The type `specs/waves.md` fixes for wave `w` of an `n`-wave run. */
export function typeOfWave(w: number, n: number): SurgeType {
  return waveType(w, n) as SurgeType;
}

/** The count `specs/waves.md` fixes for wave `w` of an `n`-wave run. */
export function sizeOfWave(w: number, n: number): number {
  return waveSize(w, n);
}

/**
 * Send the posed wave and watch every unit it releases, until it has none left to
 * release or the watch runs out.
 *
 * ONE TAP OF THE SEND KEY IS THE WHOLE ARRANGEMENT. `h.tap` presses and releases
 * `Space` and runs the one frame that delivers the edge, so by the time it returns
 * the wave has begun and — if the build releases its first unit on that frame, as
 * specs/waves.md requires — the first unit is already on the floor. The snapshot
 * taken immediately afterwards is therefore the reading `spawn-cadence` needs, and
 * it is taken before any further frame runs.
 *
 * A unit is recorded THE FIRST TIME IT IS SEEN and never again, so a unit that
 * leaks part way through a long release is still in the list with the vent and the
 * tile it arrived on. Units are recorded in roster order, which specs/instrumentation.md
 * fixes as the order they were appended in, so the list is in release order
 * whatever ids a build hands out.
 */
export async function watchRelease(
  h: Harness,
  options: WatchOptions = {},
): Promise<Release[]> {
  const poll = Math.max(1, options.poll ?? 4);
  const maxFrames = ticksFor(options.seconds ?? 30);
  const stopAfter = options.stopAfter ?? Infinity;

  const seen = new Map<number, Release>();
  const take = (snapshot: MeltdownSnapshot): void => {
    for (const unit of snapshot.surge) {
      if (seen.has(unit.id)) continue;
      seen.set(unit.id, {
        id: unit.id,
        type: unit.type,
        vent: unit.vent,
        col: unit.col,
        row: unit.row,
        x: unit.x,
        y: unit.y,
        at: snapshot.simTime,
      });
    }
  };

  await h.tap("Space");
  let snapshot = h.snapshot();
  take(snapshot);

  let frames = 0;
  while (
    snapshot.wavePending > 0 &&
    seen.size < stopAfter &&
    frames < maxFrames
  ) {
    const step = Math.min(poll, maxFrames - frames);
    await h.advance(step);
    frames += step;
    snapshot = h.snapshot();
    take(snapshot);
  }
  return [...seen.values()];
}

/**
 * Seconds of game time a wave of `count` units needs to be released in full, with
 * a whole wave's worth of slack on top.
 *
 * specs/waves.md releases one unit every `WAVE_SPAWN_INTERVAL` (`0.6`) seconds
 * beginning on the frame the wave starts, so `count` units take
 * `(count - 1) * 0.6` seconds. Doubling that and adding a second is what carries a
 * build releasing at half the specified rate through to the end of its wave, so a
 * watch that comes up short has found a build that released the wrong NUMBER of
 * units rather than one that released them slowly.
 */
export function watchSecondsFor(count: number): number {
  return 2 * Math.max(0, count - 1) * WAVE_SPAWN_INTERVAL + 1;
}
