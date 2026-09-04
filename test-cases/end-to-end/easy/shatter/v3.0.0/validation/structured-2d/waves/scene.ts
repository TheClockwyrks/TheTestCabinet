// Shatter — the cleared wave the `waves` checks share. CASE-PROVIDED.
//
// Every item in this group turns on one wave ending and the next beginning, so
// the route to a CLEARED wave is built once here rather than fourteen times over
// in fourteen checks that would drift apart.
//
// THE ROUTE IS A REAL KILL, AND THAT IS THE WHOLE POINT OF THIS FILE.
// `specs/progression.md` clears a wave "on the tick in which the last rock on the
// field is destroyed. It is a transition, not a condition on the field: a field
// that holds no rocks and has had none destroyed on that tick is a wave being
// played, not a wave cleared." `specs/instrumentation.md` says of `clearRocks()`
// that "it destroys nothing and scores nothing, so a field it emptied has had no
// rock destroyed on that tick".
//
// So a build that raises its next wave from the DESTRUCTION rather than from
// polling an empty field is exactly conformant — and the previous version of this
// case failed it three times over, because three of its wave checks reached their
// "cleared" wave by calling `clearRocks()`. NO CHECK IN THIS GROUP DOES. Every
// clear below goes through `addBullet` and is resolved by the build's own
// collision, split and scoring code, exactly as `../harness.ts`'s
// `shootFieldDown` does for the rest of the suite.
//
// The negative direction is not this file's: `an-empty-field-does-not-clear-by-
// itself` is the one check in the group that DOES empty a field with
// `clearRocks`, and it asserts that nothing turns over.
//
// NOT ONE FIGURE BELOW IS A BOUND. Everything here is arrangement and patience —
// where the last rock stands, how long one round is followed, how long a banner
// is waited out — and every tolerance stays in the check that asserts it, derived
// there from the figure `specs/` fixes for it.

import {
  MUZZLE_SPEED,
  ROCK_SPEED_MAX,
  ROCK_SPEED_MIN,
  WAVE_BANNER_TIME,
  WAVE_BASE_ROCKS,
  WAVE_SPEED_CAP,
  WAVE_SPEED_STEP,
} from "../constants";
import { fail } from "../assert";
import { QUIET_CORNER } from "../fixtures";
import { speedOf, type Vec } from "../geometry";
import {
  aimedRound,
  poseBullet,
  poseRock,
  requireRock,
  resetTo,
  rockById,
  startPlaying,
  ticksFor,
  type Harness,
  type RockSnapshot,
  type ShatterSnapshot,
} from "../harness";

/* -------------------------------------------------------------------------- */
/* Where the last rock stands                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Where every clear in this group poses its last rock: the harness's own quiet
 * corner, `(320, 620)`.
 *
 * `412` units from the star, where `specs/gravity.md`'s well pulls at about `26`
 * units per second squared — so over the four ticks a round spends crossing its
 * standoff the well moves the rock by a hundredth of a unit. Nothing in this
 * group reads a velocity off the rock that is shot, but the kill has to LAND, and
 * a target the well is dragging out from under an aimed round is a coin toss
 * rather than a scenario.
 *
 * It is also `300`-odd units from the safe point where `startPlaying` leaves the
 * ship, and clear of the star's whole drawn extent (nothing of the star is drawn
 * beyond `180`, `specs/field.md`), so the stills this group keeps show the rock
 * and the star apart.
 */
export const LAST_ROCK: Vec = QUIET_CORNER;

/**
 * The size the last rock is posed at.
 *
 * A `small`, because `specs/rocks.md` has a destroyed `large` leave two `medium`
 * and a destroyed `medium` two `small`: only destroying a `small` takes a rock
 * off the field. One round therefore empties the field, and the tick it lands on
 * is the tick the wave clears on — which is the reading every check here is
 * taken at.
 */
const LAST_ROCK_SIZE = "small" as const;

/* -------------------------------------------------------------------------- */
/* Opening a wave with the game's own loop running                            */
/* -------------------------------------------------------------------------- */

/**
 * Live play at wave `wave`, on an empty quiet field, WITH THE GAME'S OWN WAVE
 * LOOP RUNNING.
 *
 * `startPlaying` is the harness's quiet ground — an empty field, the ship at the
 * safe point, and the three gates off — and this turns exactly one of them back
 * on: `setWaveSpawning(true)`, because the wave loop IS this group's requirement.
 * The saucer's arrival and the ship's lethal contact stay off, so nothing this
 * group did not ask for wanders into a reading. `the-saucer-hunts-during-the-
 * banner` adds its own saucer by hand, which is a different thing from letting
 * the game's cadence deliver one.
 *
 * The empty field is safe precisely because of the rule this group is about: a
 * wave clears on a DESTRUCTION, so a field that has never held a rock cannot
 * clear, and the wave number holds at `wave` until {@link killTheLastRock} takes
 * one down.
 *
 * `seed` reseeds the game's randomness first, which is what lets a check fly the
 * same wave number several times over and get several different draws of its rock
 * positions and speeds (`specs/simulation.md`, "Seeded randomness"). No frame is
 * advanced: every pose lands at the call.
 */
export function openWaveAt(h: Harness, wave: number, seed?: number): void {
  if (seed !== undefined) resetTo(h, seed);
  startPlaying(h);
  h.debug.setWave(wave);
  h.debug.setWaveSpawning(true);
}

/* -------------------------------------------------------------------------- */
/* Clearing it, for real                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The ticks one round is given to cross its standoff before the drive gives up.
 *
 * `aimedRound` places a round `ROUND_STANDOFF` (`4`) units off the rock's surface
 * closing at `MUZZLE_SPEED` (`520`), which is four ticks of travel, and
 * `specs/collision.md` makes collision swept so the contact cannot be stepped
 * over. A quarter of a second is that with an order of room, so a build whose
 * rounds do not land fails naming the rule rather than hanging the suite, and a
 * round that MISSED — which would otherwise idle out its `BULLET_LIFE` of `1.5`
 * seconds — is caught here rather than mistaken for a hit.
 */
const ROUND_FLIGHT_TICKS = ticksFor(0.25);

/** What the fatal round came to, and the two ticks that bracket the clear. */
export interface Kill {
  /** Ticks driven from the round being placed to the rock leaving the roster. */
  ticks: number;
  /** The state on the last tick the rock was STILL on the field. */
  before: ShatterSnapshot;
  /** The state on the tick the rock LEFT the field: the tick the wave clears on. */
  at: ShatterSnapshot;
}

/**
 * Destroy the rock with that id with one of the ship's own rounds, and answer the
 * tick it came off the field.
 *
 * The round goes in through `addBullet` and is resolved by the build's own
 * collision and scoring code; nothing here removes a rock. `aimedRound` is the
 * harness's, and two of its properties are what make this a scenario rather than
 * a coin toss: the round comes in from the side of the rock facing AWAY from the
 * star, so `specs/collision.md`'s absorption at the core cannot take it on the
 * way in; and it carries the target's own velocity, so a drifting rock is struck
 * head-on.
 *
 * ONE TICK AT A TIME, because the tick the rock leaves the roster is the tick
 * `specs/progression.md` clears the wave on, and that is the reading five of this
 * group's checks are taken at.
 */
export async function killTheLastRock(h: Harness, id: number): Promise<Kill> {
  const target = requireRock(
    h.snapshot(),
    id,
    "the last rock on the field, on whose doorstep the fatal round is placed",
  );
  const round = aimedRound(target);
  poseBullet(h, round.x, round.y, round.vx, round.vy);

  let before = h.snapshot();
  for (let ticks = 1; ticks <= ROUND_FLIGHT_TICKS; ticks += 1) {
    await h.advance(1);
    const at = h.snapshot();
    if (rockById(at, id) === undefined) return { ticks, before, at };
    before = at;
  }
  fail(
    `the last rock destroyed by one round placed on its doorstep, closing at ` +
      `MUZZLE_SPEED (${String(MUZZLE_SPEED)}) — a bullet destroys the rock it ` +
      `strikes (specs/collision.md)`,
    `rock ${String(id)} was still on the field after ` +
      `${String(ROUND_FLIGHT_TICKS)} ticks`,
  );
}

/**
 * Put the field's last rock up, and answer its id.
 *
 * At rest, because nothing in this group reads its motion — what is read is what
 * the game does on the tick it stops existing. The well moves it while it stands
 * there, which costs nothing: `aimedRound` reads its live position and carries its
 * live velocity, so the round is aimed where the rock IS.
 *
 * SEPARATE FROM THE KILL, because a check that has to run the clock before the
 * clear must have this rock on the field FIRST. A build that clears on an empty
 * predicate rather than on a destruction — which is a real build this suite is
 * written to catch, and which `an-empty-field-does-not-clear-by-itself` is the
 * item for — turns its wave over on the first tick of an empty field, so a
 * scenario that idles before posing its rock would find a banner already up and
 * a wave already spawned, and would fail for a defect that is another item's.
 * {@link clearTheWave} is the composition for a check that needs no such run-up.
 */
export function poseLastRock(h: Harness): number {
  return poseRock(h, LAST_ROCK_SIZE, LAST_ROCK.x, LAST_ROCK.y);
}

/**
 * Pose the field's last rock and shoot it down: the clear every check in this
 * group is written around.
 *
 * No tick runs between the pose and the round, so the field is never observed
 * empty and no build's wave loop can turn over ahead of the kill.
 */
export async function clearTheWave(h: Harness): Promise<Kill> {
  return killTheLastRock(h, poseLastRock(h));
}

/* -------------------------------------------------------------------------- */
/* Waiting the banner out                                                     */
/* -------------------------------------------------------------------------- */

/**
 * How long a wave's rocks are waited for after the clear.
 *
 * A BOUND ON THE SCENARIO, NOT A THRESHOLD ON THE BUILD. `specs/progression.md`
 * runs the banner for `WAVE_BANNER_TIME` (`1.5` s) and spawns "the rocks it
 * announces … as it ends", so a conformant build puts them up at `1.5` seconds and
 * never comes near this window. It is three times that, and generous on purpose:
 * six of this group's checks need a spawned wave to read anything at all — how
 * many rocks it holds, where they stand, how fast they drift — and a build whose
 * BANNER is too long is wrong about a different rule that `banner-runs-for-1p5s`
 * already charges it for. Waiting only as long as a conformant banner would fail
 * all six of them for that one defect.
 *
 * What it still catches is a build that never spawns at all, which fails inside
 * five seconds naming the rule rather than hanging the suite.
 */
export const ARRIVAL_WINDOW_TICKS = ticksFor(3 * WAVE_BANNER_TIME + 0.5);

/** A wave arriving: the rocks it put up, and when. */
export interface Arrival {
  /** Ticks driven from the clear to the tick the first rock appeared. */
  ticks: number;
  /** The state on the tick the rocks first appeared. */
  at: ShatterSnapshot;
  /** The rocks on that tick, in roster order. */
  rocks: RockSnapshot[];
}

/**
 * Advance one tick at a time until the field holds a rock again, and answer the
 * tick it happened on.
 *
 * ONE TICK AT A TIME, and the reading is taken on the FIRST tick a rock is there,
 * because two of this group's checks read a spawned rock's position and two read
 * its speed — and `specs/rocks.md` makes the base drift speed "the speed it
 * enters the field with". Every tick a rock spends on the field afterwards is a
 * tick the well has been bending it.
 */
export async function waitForTheWave(h: Harness): Promise<Arrival> {
  for (let ticks = 1; ticks <= ARRIVAL_WINDOW_TICKS; ticks += 1) {
    await h.advance(1);
    const at = h.snapshot();
    if (at.rocks.length > 0) return { ticks, at, rocks: at.rocks };
  }
  const at = h.snapshot();
  fail(
    `the cleared wave's rocks on the field within ` +
      `${(ARRIVAL_WINDOW_TICKS / ticksFor(1)).toFixed(1)} s of the clear — the ` +
      `WAVE N banner runs for WAVE_BANNER_TIME (${String(WAVE_BANNER_TIME)} s) ` +
      `and the rocks it announces are spawned as it ends ` +
      `(specs/progression.md)`,
    `the field is still empty, with waveBanner ${String(at.waveBanner)} and ` +
      `wave ${String(at.wave)}`,
  );
}

/* -------------------------------------------------------------------------- */
/* What the specification says a wave holds                                   */
/* -------------------------------------------------------------------------- */

/** `WAVE_BASE_ROCKS + N`: the Large rocks `specs/progression.md` gives wave `N`. */
export function rocksInWave(wave: number): number {
  return WAVE_BASE_ROCKS + wave;
}

/**
 * The factor `specs/progression.md` multiplies wave `N`'s base drift speeds by:
 *
 *     1 + min(WAVE_SPEED_CAP, WAVE_SPEED_STEP * (N - 1))
 */
export function waveSpeedScale(wave: number): number {
  return 1 + Math.min(WAVE_SPEED_CAP, WAVE_SPEED_STEP * (wave - 1));
}

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
 * A wave's speeds are DRAWN — `specs/progression.md` sets each rock "drifting in
 * a random direction" at a Large's base drift speed, which `specs/rocks.md` draws
 * "uniformly from its size's range" (`60` to `110`) — so a single wave says
 * almost nothing about the factor the range was multiplied by. What the two speed
 * checks compare is a STATISTIC over many draws, and this is what gathers them:
 * each run is a fresh `reset` to its own seed, so each is an independent draw of
 * the whole wave (`specs/simulation.md`, "Seeded randomness").
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

  // UNDRAWN, AND THE WHOLE SAMPLE IS. What this reads is a speed off each rock
  // of each arrival: a hundred and twenty rocks gathered over as many as a
  // hundred and thirty runs, each of which shoots a field down a round at a
  // time. Every one of those frames would otherwise be drawn for a picture no
  // reading takes. The two items that use this draw a frame of their own for the
  // still they capture.
  return h.quiet(async () => {
    while (speeds.length < options.rocks && runs < options.maxRuns) {
      openWaveAt(h, wave - 1, options.firstSeed + runs);
      runs += 1;
      await clearTheWave(h);
      const arrival = await waitForTheWave(h);
      if (spawned === undefined) spawned = arrival.at.wave;
      else if (arrival.at.wave !== spawned) {
        fail(
          `the same wave number on every run posed at ${String(wave - 1)} and ` +
            `cleared, so one sample is one wave's speed factor ` +
            `(specs/progression.md)`,
          `run ${String(runs)} arrived at wave ${String(arrival.at.wave)}, ` +
            `where an earlier run arrived at ${String(spawned)}`,
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
 * UNIFORMLY from `[60 s, 110 s]`, where `s` is the wave's factor, and for a
 * uniform the midrange is the minimum-variance unbiased estimator of the
 * distribution's midpoint, `85 s`: its spread falls like `1 / n` rather than like
 * `1 / sqrt(n)`. Over a hundred-odd rocks the mean of a `60`-to-`110` draw still
 * wanders by about `1.4` percent, which is half of the `3` percent both items
 * allow; the midrange wanders by about a third of one percent.
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
 * nothing about where a spawn sits among them). So at most one tick of the well
 * is in every reading. `specs/progression.md` spawns no rock closer than
 * `WAVE_MIN_STAR_DIST` (`200`) to the star, where `specs/gravity.md` pulls at
 * `112.5` units per second squared — a shade under one unit per second over a
 * tick, against a smallest legal base speed of `60`.
 */
export const SPAWN_WELL_PER_TICK = 112.5 / ticksFor(1);

/** The smallest and largest base drift speed `specs/rocks.md` gives a Large. */
export const BASE_SPEED_MIN = ROCK_SPEED_MIN.large;
export const BASE_SPEED_MAX = ROCK_SPEED_MAX.large;
