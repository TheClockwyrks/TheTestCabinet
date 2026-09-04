// Shatter — the cleared field every `waves` check starts from. CASE-PROVIDED.
//
// THIS GROUP IS THE ONE THAT MAY NOT TAKE THE SHORTCUT. `specs/progression.md`
// states the clear rule as a TRANSITION: "A wave clears on the tick in which the
// last rock on the field is destroyed. It is a transition, not a condition on the
// field: a field that holds no rocks and has had none destroyed on that tick is a
// wave being played, not a wave cleared." And `specs/instrumentation.md` says of
// `clearRocks` that it "empties the rocks alone. It destroys nothing and scores
// nothing."
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

import {
  MU,
  STAR_X,
  STAR_Y,
  TICK_DT,
  WAVE_BANNER_TIME,
  WAVE_BASE_ROCKS,
  WAVE_MIN_STAR_DIST,
  WAVE_SPEED_CAP,
  WAVE_SPEED_STEP,
} from "../constants";
import { fail } from "../assert";
import { STAR, distance } from "../geometry";
import {
  poseRock,
  shootFieldDown,
  shootRock,
  speedOf,
  startPlaying,
  tapAction,
  ticksFor,
  type Harness,
  type RockSize,
  type UntilResult,
} from "../harness";
import type { ShatterSnapshot } from "../surface";

/* -------------------------------------------------------------------------- */
/* The two formulas `specs/progression.md` states                             */
/* -------------------------------------------------------------------------- */
//
// DERIVATIONS, NOT THRESHOLDS. Each is the specification's own arithmetic written
// once so five checks read the same figure, and each is built out of the figures
// `../constants` transcribes from `specs/progression.md` rather than out of a
// number typed here.

/**
 * How many Large rocks wave `n` puts up: `WAVE_BASE_ROCKS + n`.
 *
 * `specs/progression.md`, Waves: "Wave `N` spawns `WAVE_BASE_ROCKS + N` (`3 + N`)
 * Large rocks, so wave 1 puts up four and wave 2 puts up five."
 */
export function waveRockCount(n: number): number {
  return WAVE_BASE_ROCKS + n;
}

/**
 * The multiplier wave `n` applies to a Large's base drift speed range:
 * `1 + min(WAVE_SPEED_CAP, WAVE_SPEED_STEP * (n - 1))`.
 *
 * `specs/progression.md`, Waves, verbatim — "so wave 1's rocks take the plain
 * range, wave 6's are `20` percent faster, and every wave from 11 onward is `40`
 * percent faster."
 */
export function waveSpeedScale(n: number): number {
  return 1 + Math.min(WAVE_SPEED_CAP, WAVE_SPEED_STEP * (n - 1));
}

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
export const LAST_ROCK = { x: 240, y: 360 } as const;

/**
 * Where the two Large rocks a shot-down field starts with stand.
 *
 * Both are more than `WAVE_MIN_STAR_DIST` from the star and in opposite corners of
 * the field, so the Mediums and Smalls they come apart into scatter into open
 * ground rather than into each other or into the core. They stand at rest, which
 * `addRock` is defined to give them, and over the second or so a shoot-down takes
 * the well moves them by a handful of units.
 */
export const STANDING_ROCKS: readonly { x: number; y: number }[] = [
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
 * in between. Nothing here advances the engine, so the field never spends a single
 * tick empty with the loop open — which would hand a build that clears on an
 * emptiness PREDICATE a banner nobody asked for, and leave every check here reading
 * a wave it never cleared.
 */
export function poseLiveWave(h: Harness, spec: LiveWave = {}): void {
  startPlaying(h);
  h.debug.setWave(spec.wave ?? 1);
  for (let n = 0; n < (spec.large ?? 0); n += 1) {
    const at = STANDING_ROCKS[n % STANDING_ROCKS.length];
    poseRock(h, "large", at.x, at.y);
  }
  poseRock(h, "small", LAST_ROCK.x, LAST_ROCK.y);
  h.debug.setWaveSpawning(true);
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
 * Destroy the rock with that id with one placed round, and answer the state on the
 * tick it died.
 *
 * The round goes in through `addBullet` on the rock's doorstep and the BUILD's own
 * collision code is what resolves it, so a build whose rounds do not destroy rocks
 * fails here naming the rule of `specs/collision.md` it missed rather than handing
 * a later line a rock that is still standing.
 */
export async function destroyRock(
  h: Harness,
  id: number,
): Promise<ShatterSnapshot> {
  const shot = await shootRock(h, id);
  if (!shot.spent) {
    fail(
      `a round placed on rock ${id}'s doorstep to reach it: specs/collision.md ` +
        `destroys a rock a bullet touches, and specs/gravity.md pulls the round ` +
        `in a straight line over the handful of ticks its flight takes`,
      `the round was still in flight after ${shot.ticks} ticks`,
    );
  }
  if (!shot.destroyed) {
    fail(
      `rock ${id} destroyed by the round that reached it (specs/collision.md)`,
      `the rock was still on the field after ${shot.ticks} ticks`,
    );
  }
  return h.snapshot();
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
  const before = h.snapshot();
  if (before.rocks.length !== 1) {
    fail(
      "a field shot down to exactly one Small, so the next kill is the last " +
        "rock (specs/progression.md)",
      `${before.rocks.length} rocks were standing`,
    );
  }
  const snapshot = await destroyRock(h, before.rocks[0].id);
  return { wave: before.wave, before, snapshot };
}

/** Pose a live wave and shoot it clear, in one call. */
export async function clearAWave(
  h: Harness,
  spec: LiveWave = {},
): Promise<Cleared> {
  poseLiveWave(h, spec);
  return shootTheFieldClear(h);
}

/* -------------------------------------------------------------------------- */
/* Opening a real game                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Open a game the way a player does: a reset title, then the confirm action over
 * `PLAY`.
 *
 * `wave-one-spawns-four` is the one check in this group that cannot pose its
 * scenario at all — `specs/instrumentation.md` has `setWave` spawn no rocks, so
 * there is no operation that produces an OPENING wave — and this is the route it
 * takes instead. `reset` leaves both world gates on and the highlight on the
 * title's first entry (`specs/ui.md`), so the wave that arrives is the one the
 * build's own spawner put up.
 */
export async function startGameFromTitle(
  h: Harness,
  options: { seed?: number } = {},
): Promise<void> {
  h.debug.reset(
    options.seed === undefined ? undefined : { seed: options.seed },
  );
  h.debug.setMenuIndex(0);
  await tapAction(h, "confirm");
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
    maxFrames: CLEAR_GRACE_TICKS,
    poll: 1,
  });
  if (grace.hit) return grace.snapshot;
  return fail(
    `a WAVE N banner running within ${CLEAR_GRACE_TICKS} tick of the last rock ` +
      `being destroyed (specs/progression.md)`,
    `waveBanner was ${grace.snapshot.waveBanner} with ` +
      `${grace.snapshot.rocks.length} rocks on the field`,
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
  await h.until(
    (snapshot) =>
      snapshot.rocks.length > 0 || snapshot.waveBanner <= COARSE_FLOOR,
    { maxFrames: ARRIVAL_TICKS, poll: COARSE_POLL },
  );
  return h.until((snapshot) => snapshot.rocks.length > 0, {
    maxFrames: ARRIVAL_TICKS,
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
      `the wave announced by clearing wave ${cleared.wave} on the field within ` +
        `${WAVE_BANNER_TIME + ARRIVAL_GRACE} seconds (specs/progression.md)`,
      `the rock roster was still empty, with waveBanner ` +
        `${arrival.snapshot.waveBanner} and wave ${arrival.snapshot.wave}`,
    );
  }
  return arrival.snapshot;
}

/* -------------------------------------------------------------------------- */
/* Reading a spawned wave                                                     */
/* -------------------------------------------------------------------------- */

/** How far a rock stands from the star's centre, by shortest wrapped separation. */
export function starClearance(rock: { x: number; y: number }): number {
  return distance(rock, STAR);
}

/** How far a rock stands from the ship, by shortest wrapped separation. */
export function shipClearance(
  snapshot: ShatterSnapshot,
  rock: { x: number; y: number },
): number {
  return distance(rock, { x: snapshot.ship.x, y: snapshot.ship.y });
}

/** A rock as one short string, for a failure message that has to name which one. */
export function describeRock(rock: {
  id: number;
  size: RockSize;
  x: number;
  y: number;
}): string {
  return `rock ${rock.id} (${rock.size}) at (${rock.x.toFixed(1)}, ${rock.y.toFixed(1)})`;
}

/** The star's centre, named here so a message can print the pair. */
export const STAR_AT = `(${STAR_X}, ${STAR_Y})`;

/* -------------------------------------------------------------------------- */
/* Sampling a wave's base drift speeds                                        */
/* -------------------------------------------------------------------------- */

/** A wave's base drift speeds, and the wave number the build spawned them for. */
export interface SpeedSample {
  /** The wave number the build reported when the rocks arrived. */
  wave: number;
  /** How many waves were flown to gather them. */
  runs: number;
  /** Every rock's speed, read on the tick its wave arrived. */
  speeds: number[];
}

/** How many rocks a speed sample gathers, and how many waves it may fly for them. */
export interface SampleOptions {
  /** How many speeds are wanted. The sweep stops once it holds this many. */
  rocks: number;
  /** The most waves it will fly. A ceiling on the scenario, not a threshold. */
  maxRuns: number;
  /** The seed the first run is reset to; each later run takes the next. */
  firstSeed: number;
}

/**
 * Every base drift speed a wave puts up, gathered over as many fresh runs as it
 * takes to hold `rocks` of them.
 *
 * A wave's speeds are DRAWN — `specs/progression.md` sets each rock "drifting in a
 * random direction" at a Large's base drift speed, which `specs/rocks.md` draws
 * "uniformly from its size's range" (`60` to `110`) — so a single wave says almost
 * nothing about the factor the range was multiplied by. What the two speed checks
 * compare is a STATISTIC over many draws, and this is what gathers them: each run
 * is a fresh `reset` to its own seed, so each is an independent draw of the whole
 * wave (`specs/simulation.md`, "Seeded randomness").
 *
 * A ROCK COUNT RATHER THAN A RUN COUNT, and that is not a detail. How many rocks a
 * wave holds is the BUILD's answer to a different rule, and `wave-one-spawns-four`
 * and `wave-n-spawns-three-plus-n` are the items for it. A sweep of a fixed number
 * of RUNS would hand a build that spawns too few rocks a smaller sample and a
 * noisier statistic, and could fail it on the speed rule for a defect in the count
 * rule. Gathering to a rock count gives every build the same sample and the same
 * precision, and it is `maxRuns` that keeps a build spawning almost nothing from
 * spinning.
 *
 * THE WAVE NUMBER COMES BACK BECAUSE THE FACTOR IS A FUNCTION OF IT, and the two
 * speed checks read the factor against the wave the BUILD says it spawned rather
 * than the one this posed — for the same reason, and against the same neighbouring
 * item, `wave-number-increments`. The wave has to be the SAME across every run, or
 * the sample is a mixture of two factors and its midrange means nothing.
 *
 * `wave` is the wave whose speeds are wanted, so the game is posed at `wave - 1`
 * and cleared into it.
 */
export async function sampleWaveSpeeds(
  h: Harness,
  wave: number,
  options: SampleOptions,
): Promise<SpeedSample> {
  const speeds: number[] = [];
  let spawned: number | undefined;
  let runs = 0;

  // UNDRAWN, AND THE WHOLE SAMPLE IS. What this reads is a speed off each rock of
  // each arrival: a hundred and twenty rocks gathered over as many as a hundred
  // and thirty runs, each of which shoots a field down a round at a time. Every
  // one of those ticks would otherwise be drawn for a picture no reading takes.
  // The two items that use this capture their still after it, on a drawn tick.
  return h.quiet(async () => {
    while (speeds.length < options.rocks && runs < options.maxRuns) {
      h.debug.reset({ seed: options.firstSeed + runs });
      runs += 1;
      const cleared = await clearAWave(h, { wave: wave - 1 });
      const arrival = await arrivedWave(h, cleared);
      if (spawned === undefined) spawned = arrival.wave;
      else if (arrival.wave !== spawned) {
        fail(
          `the same wave number on every run posed at ${String(wave - 1)} and ` +
            `cleared, so one sample is one wave's speed factor ` +
            `(specs/progression.md)`,
          `run ${String(runs)} arrived at wave ${String(arrival.wave)}, where an ` +
            `earlier run arrived at ${String(spawned)}`,
        );
      }
      for (const rock of arrival.rocks) speeds.push(speedOf(rock));
    }

    return { wave: spawned ?? wave, runs, speeds };
  });
}

/**
 * The midpoint of a sample's observed range, `(min + max) / 2`.
 *
 * THE STATISTIC BOTH SPEED CHECKS COMPARE, and it is chosen rather than the mean
 * because of how fast each converges. `specs/rocks.md` draws a base speed
 * UNIFORMLY from `[60 s, 110 s]`, where `s` is the wave's factor, and for a uniform
 * the midrange is the minimum-variance unbiased estimator of the distribution's
 * midpoint, `85 s`: its spread falls like `1 / n` rather than like `1 / sqrt(n)`.
 * Over a hundred-odd rocks the mean of a `60`-to-`110` draw still wanders by about
 * `1.4` percent, which is half of the `3` percent both items allow; the midrange
 * wanders by about a third of one percent.
 *
 * The ratio of two waves' midranges is therefore the ratio of their factors, with
 * the base range `specs/rocks.md` fixes cancelling out of it entirely — which is
 * what keeps these two items about the SCALING and leaves the range itself to
 * `rocks/drift-speed-large`.
 */
export function midrange(values: readonly number[]): number {
  if (values.length === 0) {
    fail("at least one sampled base drift speed", "no rocks were sampled");
  }
  return (Math.min(...values) + Math.max(...values)) / 2;
}

/**
 * How far one tick of the well can move a base drift speed at the closest a wave
 * may spawn to the star, in units per second.
 *
 * A rock is read on the first tick it is on the field, but whether the build
 * spawned it before or after that tick's gravity step is the build's own business
 * (`specs/simulation.md` fixes the order of the six steps in a tick and says
 * nothing about where a spawn sits among them). So at most one tick of the well is
 * in every reading. `specs/progression.md` spawns no rock closer than
 * `WAVE_MIN_STAR_DIST` (`200`) to the star, where `specs/gravity.md` pulls at
 * `MU / d^2` — a shade under one unit per second over a tick, against a smallest
 * legal base speed of `60`.
 */
export const SPAWN_WELL_PER_TICK = (MU / WAVE_MIN_STAR_DIST ** 2) * TICK_DT;
