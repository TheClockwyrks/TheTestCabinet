// Wick — audio/cues: what every check in this directory shares. CASE-PROVIDED.
//
// HOW A CUE IS READ. `specs/ui.md` names the fifteen cues and binds each to
// one event, and the build plays them by name through `world.audio`. The
// engine announces every play on its bus, synchronously from inside the call,
// so the harness's collector holds exactly the cues the frames it was open
// across raised, each stamped with the frame it sounded on. Under this engine
// one frame on `playing` is one tick (`specs/instrumentation.md`, The clock),
// so a collector opened before a one-frame drive and read after it holds
// exactly the cues of one tick.
//
// WHY THE SETTLE TICK. `music` "is looping on every frame exactly when
// `screen` is `playing`, `levelup`, `chest`, or `paused`" and "Both loops are
// reconciled from the state on every frame", so the frame after an isolated
// run is posed is the frame the bed starts on, and its `cue:looped` is a
// sound of the arrangement rather than of the scenario. {@link isolatedRun}
// spends that frame before the scenario is posed, over a world holding
// nothing with every driver switch off, so nothing else advances on it.
//
// WHAT A COLLECTOR IS NOT. Nothing here decides an outcome. A pose "changes
// the state alone and sounds nothing" (`specs/instrumentation.md`), so every
// cue a check reads was raised by a real tick or a real frame the build ran.

import {
  advanceTicks,
  armWeapon,
  holdWeapon,
  isolate,
  onCue,
  placeEnemyNear,
  pointAt,
  type Harness,
  type IsolateOptions,
  type TimedCue,
  type WickSnapshot,
} from "../harness";

/**
 * Pose an isolated `playing` run and spend the one frame the loops are
 * reconciled on, so a collector opened after this holds only what the
 * scenario's own ticks raised.
 *
 * The tick it spends runs over a world holding no enemy, projectile, zone,
 * gem, or pickup with every driver switch off, so it moves nothing and sounds
 * nothing but the bed's start.
 */
export async function isolatedRun(
  h: Harness,
  options: IsolateOptions = {},
): Promise<WickSnapshot> {
  isolate(h, options);
  return advanceTicks(h, 1);
}

/**
 * Record every cue `act` raises, and hand back both what it returned and what
 * sounded while it ran.
 */
export async function cuesOf<T>(
  h: Harness,
  act: () => T | Promise<T>,
): Promise<{ result: T; played: TimedCue[] }> {
  const played = onCue(h);
  const result = await act();
  return { result, played: [...played] };
}

/** How many of `played` carry the name `cue`. */
export function heard(played: readonly TimedCue[], cue: string): number {
  return played.filter((entry) => entry.name === cue).length;
}

/**
 * Run `frames` frames ONE AT A TIME, reading after each whether `cue` is
 * looping. Entry `i` is the reading after frame `i + 1`.
 *
 * The reading is `world.audio.looping`, which "reports whether it is"
 * (`specs/ui.md`), so what a trace holds is the bus's own answer on every
 * frame of a span rather than one sample at the end of it.
 */
export async function loopTrace(
  h: Harness,
  cue: string,
  frames: number,
): Promise<boolean[]> {
  const trace: boolean[] = [];
  for (let frame = 0; frame < frames; frame += 1) {
    await h.advance(1);
    trace.push(h.looping(cue));
  }
  return trace;
}

/** How far out the moths of {@link burnMoths} stand from the lamplighter. */
export const MOTH_RING = 300;

/**
 * The moths a Flare burst catches in one tick, for the two "at most once per
 * tick" checks that need one tick to raise one cue over many enemies.
 *
 * `count` moths stand evenly around a ring `MOTH_RING` units out, well inside
 * the burst's `640` radius (`specs/weapons.md`, Flare) and well outside both
 * the lamplighter's `PICKUP_RADIUS` (`48`) and the collection distance of a
 * pickup, so the gems and any bread the deaths drop land where the moths
 * stood and are neither attracted nor collected on that tick. Flare is the
 * only weapon held and it "fires whether or not any enemy exists", so the one
 * armed tick is a single burst hitting every moth at once.
 */
export async function burnMoths(
  h: Harness,
  count: number,
): Promise<{ before: WickSnapshot; ids: number[] }> {
  await isolatedRun(h);
  const ids: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const post = pointAt({ x: 0, y: 0 }, (index * 360) / count, MOTH_RING);
    ids.push(placeEnemyNear(h, "moth", post.x, post.y));
  }
  armWeapon(h, holdWeapon(h, "flare", 1));
  return { before: h.snapshot(), ids };
}
