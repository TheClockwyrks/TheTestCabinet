// Shatter — the cleared field every `waves` check starts from. CASE-PROVIDED.
//
// THIS GROUP IS THE ONE THAT MAY NOT TAKE THE SHORTCUT. `specs/progression.md`
// states the clear rule as a TRANSITION: "A wave clears on the tick in which the
// last rock on the field is destroyed. It is a transition, not a condition on the
// field: a field that holds no rocks and has had none destroyed on that tick is a
// wave being played, not a wave cleared." And `specs/instrumentation.md` says of
// `clearRocks` that "it destroys nothing and scores nothing, so a field it emptied
// has had no rock destroyed on that tick".
//
// So a check that reached a banner by calling `clearRocks` would be grading the
// debug operation rather than the game: a build that raises its next wave from the
// destruction event — which is the reading the specification actually states — is
// conformant and would fail. Every scenario below therefore reaches its cleared
// field by SHOOTING the rocks down, through `addBullet` and the build's own
// collision and split code, and no check in this group calls `clearRocks` except
// `an-empty-field-does-not-clear-by-itself`, whose whole requirement is that
// emptying the field that way clears nothing.
//
// IT LIVES IN THE GROUP RATHER THAN IN `../harness.ts` because nothing outside
// `waves` wants it. Every other group in this project runs with the wave loop SHUT
// (`startPlaying`), precisely so a wave cannot arrive in the middle of its
// measurement; this group is the one whose requirement the loop is, so this is the
// one place that opens it again.
//
// NOT ONE FIGURE BELOW IS A BOUND. Everything here is a placement or a span; every
// tolerance stays in the check that asserts it, derived there from the figure
// `specs/` fixes for it.

import { fail } from "../assert";
import {
  STAR_X,
  STAR_Y,
  TICK_DT,
  WAVE_BANNER_TIME,
  WAVE_MIN_SHIP_DIST,
  WAVE_MIN_STAR_DIST,
  type RockSize,
} from "../constants";
import { wrappedDistance, type Vec } from "../geometry";
import {
  destroyRock,
  poseRock,
  shootFieldDown,
  startPlaying,
  ticksFor,
  type Harness,
  type ShatterSnapshot,
  type UntilResult,
} from "../harness";

/* -------------------------------------------------------------------------- */
/* Where a posed rock stands                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Where the rock a scenario shoots down last stands: `(240, 360)`.
 *
 * `400` units left of the star on its own row, which puts three properties in
 * place at once. It is well outside `WAVE_MIN_STAR_DIST`, so the well moves it a
 * few units over the handful of ticks a round takes to cross its standoff and it
 * is nowhere near being recycled by the core (`specs/collision.md`). Its outward
 * direction is exactly `-x`, so `aimedRound` places the round squarely to its left
 * and fires it right, with the whole flight on the far side of the star from the
 * core. And it is `447` units from the safe point where `startPlaying` leaves the
 * ship, so nothing a check poses on the ship's account reaches it.
 */
export const LAST_ROCK: Vec = { x: 240, y: 360 };

/**
 * Where the two Large rocks a shot-down field starts with stand.
 *
 * Both are more than `WAVE_MIN_STAR_DIST` from the star and in opposite corners of
 * the field, so the Mediums and Smalls they come apart into scatter into open
 * ground rather than into each other or into the core. They stand at rest, which
 * `addRock` is defined to give them, and over the second or so a shoot-down takes
 * the well moves them by a handful of units.
 */
export const STANDING_ROCKS: readonly Vec[] = [
  { x: 200, y: 120 },
  { x: 1080, y: 600 },
];

/* -------------------------------------------------------------------------- */
/* Posing a live wave                                                         */
/* -------------------------------------------------------------------------- */

/** How a live wave is posed: which wave it is, and what stands on the field. */
export interface LiveWave {
  /** The wave the run is on. Defaults to `1`. */
  wave?: number;
  /** How many Large rocks stand beside the last Small. Defaults to none. */
  large?: number;
}

/**
 * Pose a live field at `wave`, with rocks on it and the game's own wave loop
 * RUNNING.
 *
 * `startPlaying` shuts the loop, because every other group in this project needs it
 * shut; this is the group whose requirement it is, so it opens again here. The
 * order matters and is the whole reason this is a helper rather than four lines in
 * a check: THE ROCKS ARE ON THE FIELD BEFORE THE LOOP IS OPENED, and no tick runs
 * in between. The harness holds the game off the wall clock, so the field never
 * spends a single tick empty with the loop open — which would hand a build that
 * clears on an emptiness PREDICATE a banner nobody asked for, and leave every check
 * here reading a wave it never cleared.
 */
export async function poseLiveWave(
  h: Harness,
  spec: LiveWave = {},
): Promise<void> {
  await startPlaying(h, { wave: spec.wave ?? 1 });
  for (let n = 0; n < (spec.large ?? 0); n += 1) {
    const at = STANDING_ROCKS[n % STANDING_ROCKS.length];
    await poseRock(h, "large", at.x, at.y);
  }
  await poseRock(h, "small", LAST_ROCK.x, LAST_ROCK.y);
  await h.debug.setWaveSpawning(true);
}

/* -------------------------------------------------------------------------- */
/* Clearing it                                                                */
/* -------------------------------------------------------------------------- */

/** What a wave cleared by shooting leaves behind for a check to read. */
export interface Cleared {
  /** The wave that was being played when the last rock died. */
  wave: number;
  /** The state one tick BEFORE the last rock was destroyed, with it still standing. */
  before: ShatterSnapshot;
  /** The state on the tick the last rock was destroyed. */
  snapshot: ShatterSnapshot;
}

/**
 * Shoot the standing field down to its last Small and destroy that, and report the
 * tick either side of the kill.
 *
 * The BEFORE reading is what makes this a transition rather than a state: a check
 * that only read the tick after the kill could not tell a build that cleared on the
 * last rock from one that had already cleared three rocks earlier.
 *
 * Every round of it goes in through `addBullet` on the target's doorstep, and the
 * loop stops on Smalls as well as on a count, because destroying a Large leaves two
 * Mediums and destroying a Medium leaves two Smalls — only destroying a Small takes
 * a rock off the field, so "one rock standing" is only true of a Small.
 */
export async function shootTheFieldClear(h: Harness): Promise<Cleared> {
  await shootFieldDown(h, { leave: 1 });
  const before = await h.snapshot();
  if (before.rocks.length !== 1) {
    fail(
      "a field shot down to exactly one Small, so the next kill is the last rock (specs/progression.md)",
      `${before.rocks.length} rocks were standing`,
    );
  }
  const { result } = await destroyRock(h, before.rocks[0].id);
  return { wave: before.wave, before, snapshot: result.snapshot };
}

/** Pose a live wave and shoot it clear, in one call. */
export async function clearAWave(
  h: Harness,
  spec: LiveWave = {},
): Promise<Cleared> {
  await poseLiveWave(h, spec);
  return shootTheFieldClear(h);
}

/* -------------------------------------------------------------------------- */
/* Reading the banner and the wave it announces                               */
/* -------------------------------------------------------------------------- */

/**
 * How many ticks after the kill the banner is allowed to appear: one.
 *
 * `specs/progression.md` raises the banner "on the tick a wave clears", and
 * `specs/simulation.md` puts collision resolution last in a tick — so a build that
 * notices the destroyed rock inside that step raises the banner on the same tick,
 * and one that notices it at the top of its next step raises it on the next. That
 * is the whole latitude the tick order leaves, and it is one tick; it is not slack
 * for a build that raises the banner late, which one extra tick cannot hide.
 */
export const CLEAR_GRACE_TICKS = 1;

/**
 * The state on the first tick the banner raised by `cleared` is showing, or a
 * failure naming what the scenario needed.
 *
 * Every check that reads what happens WHILE a banner runs starts here, so a build
 * that clears its wave without announcing it is reported the same way wherever it
 * is met rather than each check inventing its own account of it.
 */
export async function bannerUp(
  h: Harness,
  cleared: Cleared,
): Promise<ShatterSnapshot> {
  if (cleared.snapshot.waveBanner > 0) return cleared.snapshot;
  const grace = await h.until((snapshot) => snapshot.waveBanner > 0, {
    maxTicks: CLEAR_GRACE_TICKS,
    poll: 1,
  });
  if (grace.hit) return grace.snapshot;
  return fail(
    `a WAVE N banner running within ${CLEAR_GRACE_TICKS} tick of the last rock being destroyed (specs/progression.md)`,
    `waveBanner was ${grace.snapshot.waveBanner} with ${grace.snapshot.rocks.length} rocks on the field`,
  );
}

/**
 * How long past `WAVE_BANNER_TIME` a wave is given to arrive: half a second.
 *
 * A ceiling on a build that never spawns, not a schedule. A build that spawns as
 * the banner ends is read on the tick it spawns, whenever that is; this only
 * decides how long a check waits before calling the wave missing.
 */
export const ARRIVAL_GRACE = 0.5;

/** Ticks a check waits for a cleared wave's rocks to reach the field. */
export const ARRIVAL_TICKS = ticksFor(WAVE_BANNER_TIME + ARRIVAL_GRACE);

/**
 * How the march to a banner's end is divided: coarse strides while the banner still
 * has more than a stride left, then one tick at a time.
 *
 * THE ARRIVAL HAS TO BE READ ON THE TICK IT HAPPENS. Two of this group's checks
 * read a rock's SPEED off the arrival, and `specs/gravity.md`'s well is working on a
 * rock from the moment it exists — at `WAVE_MIN_STAR_DIST` it adds most of a unit
 * per second to a rock's speed in every tick that passes — so a reading taken even
 * eight ticks late is partly the environment's rather than the wave's.
 *
 * THE COARSE PHASE IS STEERED BY THE BUILD'S OWN CLOCK, not by the specification's
 * figure for it. It runs until the build's `waveBanner` is inside TWO strides of
 * zero, so a build whose banner is half the stated length — and which therefore
 * runs its clock down twice as fast — still hands over to the fine phase before it
 * spawns, and nothing about `WAVE_BANNER_TIME` enters the reading. It also stops
 * the moment a rock appears, so a build that spawns its wave early — which
 * `no-rock-during-the-banner` is the item for — is read within a stride rather
 * than at the end of the banner.
 */
export const COARSE_POLL = 8;
export const COARSE_FLOOR = 2 * COARSE_POLL * TICK_DT;

/**
 * Run from a cleared wave to the first tick its rocks are on the field, and report
 * where the sweep stopped.
 */
export async function waveArrival(h: Harness): Promise<UntilResult> {
  await h.skipUntil(
    (snapshot) =>
      snapshot.rocks.length > 0 || snapshot.waveBanner <= COARSE_FLOOR,
    { maxTicks: ARRIVAL_TICKS, poll: COARSE_POLL },
  );
  return h.skipUntil((snapshot) => snapshot.rocks.length > 0, {
    maxTicks: ARRIVAL_TICKS,
    poll: 1,
  });
}

/**
 * The wave a cleared wave's rocks belong to, on the first tick they are on the
 * field, or a failure naming what the scenario needed.
 */
export async function arrivedWave(
  h: Harness,
  cleared: Cleared,
): Promise<ShatterSnapshot> {
  const arrival = await waveArrival(h);
  if (!arrival.hit) {
    fail(
      `the wave announced by clearing wave ${cleared.wave} on the field within ${WAVE_BANNER_TIME + ARRIVAL_GRACE} seconds (specs/progression.md)`,
      `the rock roster was still empty, with waveBanner ${arrival.snapshot.waveBanner} and wave ${arrival.snapshot.wave}`,
    );
  }
  return arrival.snapshot;
}

/* -------------------------------------------------------------------------- */
/* Reading a spawned wave                                                     */
/* -------------------------------------------------------------------------- */

/** The speed of a body, from the velocity the snapshot reports. */
export function speedOf(body: { vx: number; vy: number }): number {
  return Math.hypot(body.vx, body.vy);
}

/** How far a rock stands from the star's centre, by shortest wrapped separation. */
export function starClearance(rock: { x: number; y: number }): number {
  return wrappedDistance(rock, { x: STAR_X, y: STAR_Y });
}

/** How far a rock stands from the ship, by shortest wrapped separation. */
export function shipClearance(
  snapshot: ShatterSnapshot,
  rock: {
    x: number;
    y: number;
  },
): number {
  return wrappedDistance(rock, { x: snapshot.ship.x, y: snapshot.ship.y });
}

/**
 * The clearances `specs/progression.md` fixes, restated here so a check that reads
 * one names the other in its message and a reader can see both figures at once.
 */
export const CLEARANCES = {
  ship: WAVE_MIN_SHIP_DIST,
  star: WAVE_MIN_STAR_DIST,
} as const;

/** A rock as one short string, for a failure message that has to name which one. */
export function describeRock(rock: {
  id: number;
  size: RockSize;
  x: number;
  y: number;
}): string {
  return `rock ${rock.id} (${rock.size}) at (${rock.x.toFixed(1)}, ${rock.y.toFixed(1)})`;
}

/* -------------------------------------------------------------------------- */
/* Sampling a wave's base drift speeds                                        */
/* -------------------------------------------------------------------------- */

/** One rock of one spawned wave, as the two speed checks read it. */
export interface SpeedSample {
  /** The seed the game was opened on, so a failure can name the game. */
  seed: number;
  /** The wave the rock belongs to. */
  wave: number;
  /** The rock's id, so a failure can name the rock. */
  id: number;
  /** The magnitude of the velocity it entered the field with. */
  speed: number;
}

/**
 * Clear a wave on each of `seeds` and hand back the speed of every rock the wave
 * that followed put up.
 *
 * A WAVE IS ONE SAMPLE OF A DRAW, NOT A FIGURE. `specs/rocks.md` gives a rock's
 * base drift speed as a value "drawn uniformly from its size's range", and
 * `specs/simulation.md` lists those draws among the game's seeded randomness — so
 * a single wave says almost nothing about the multiplier `specs/progression.md`
 * applies to the range, and a hundred rocks says a great deal. This gathers the
 * hundred; what counts as agreement is decided in the check that asserts it.
 *
 * EVERY SPEED IS READ ON THE TICK ITS ROCK ARRIVED, through {@link waveArrival},
 * because `specs/gravity.md`'s well starts working on a rock the moment it exists:
 * a rock two hundred units out gains most of a unit per second of speed in every
 * tick that passes, so a reading taken even a tenth of a second late is partly the
 * environment's rather than the wave's.
 */
export async function gatherSpawnSpeeds(
  h: Harness,
  posedWave: number,
  seeds: readonly number[],
): Promise<SpeedSample[]> {
  const samples: SpeedSample[] = [];
  for (const seed of seeds) {
    await h.debug.reset({ seed });
    const cleared = await clearAWave(h, { wave: posedWave });
    const arrival = await arrivedWave(h, cleared);
    for (const rock of arrival.rocks) {
      samples.push({
        seed,
        wave: arrival.wave,
        id: rock.id,
        speed: speedOf(rock),
      });
    }
  }
  return samples;
}

/** The arithmetic mean of a sample, which is what a uniform draw's midpoint predicts. */
export function meanOf(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** The sample whose speed is the lowest, for a failure message that names one. */
export function slowest(samples: readonly SpeedSample[]): SpeedSample {
  return samples.reduce((low, one) => (one.speed < low.speed ? one : low));
}

/** The sample whose speed is the highest, for a failure message that names one. */
export function fastest(samples: readonly SpeedSample[]): SpeedSample {
  return samples.reduce((high, one) => (one.speed > high.speed ? one : high));
}

/** One speed sample as a short string, for a message that has to name which rock. */
export function describeSample(sample: SpeedSample): string {
  return `rock ${sample.id} of wave ${sample.wave} on seed ${sample.seed}, at ${sample.speed.toFixed(2)} units per second`;
}
