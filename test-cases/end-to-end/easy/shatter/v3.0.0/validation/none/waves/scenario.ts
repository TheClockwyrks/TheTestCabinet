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
  MU,
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
  HANDLE,
  destroyRock,
  failSurface,
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
 *
 * THE SWEEP RUNS INSIDE THE PAGE, and it is the same sweep: the build's own
 * `advance`, then the build's own `snapshot`, coarse strides first and then a tick
 * at a time, with the phases and the ceiling exactly as described above. Every wave
 * this project clears runs one of these, and the two speed items run fifty apiece;
 * sampled from outside, the arrival costs forty round trips into the page per wave
 * and the item's verdict becomes a fact about how loaded the host was. Nothing is
 * simulated here, and no tick is fabricated: what is saved is the round trip.
 */
export async function waveArrival(h: Harness): Promise<UntilResult> {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
  const traced = (await h.page.evaluate(
    ([handle, spec]) => {
      const api = (window as unknown as Record<string, unknown>)[handle] as
        | {
            advance(n: number): void;
            snapshot(): { rocks: unknown[]; waveBanner: number };
          }
        | undefined;
      if (
        api === undefined ||
        typeof api.advance !== "function" ||
        typeof api.snapshot !== "function"
      ) {
        return { fault: "advance and snapshot on the debug surface" };
      }
      try {
        const arrived = (snapshot: { rocks: unknown[] }): boolean =>
          snapshot.rocks.length > 0;
        let snapshot = api.snapshot();
        // The coarse phase: strides until a rock is up or the build's own banner
        // clock is inside two strides of zero.
        let coarse = 0;
        while (
          !arrived(snapshot) &&
          snapshot.waveBanner > spec.coarseFloor &&
          coarse < spec.maxTicks
        ) {
          const stride = Math.min(spec.coarsePoll, spec.maxTicks - coarse);
          api.advance(stride);
          coarse += stride;
          snapshot = api.snapshot();
        }
        // The fine phase: a tick at a time, so the arrival is read on the tick it
        // happens rather than up to a stride after it.
        let ticks = 0;
        while (!arrived(snapshot) && ticks < spec.maxTicks) {
          api.advance(1);
          ticks += 1;
          snapshot = api.snapshot();
        }
        return { read: { hit: arrived(snapshot), ticks, snapshot } };
      } catch (error) {
        return { fault: String(error) };
      }
    },
    [
      HANDLE,
      {
        maxTicks: ARRIVAL_TICKS,
        coarsePoll: COARSE_POLL,
        coarseFloor: COARSE_FLOOR,
      },
    ] as [
      string,
      { maxTicks: number; coarsePoll: number; coarseFloor: number },
    ],
  )) as { fault?: string; read?: UntilResult };
  if (traced.fault !== undefined || traced.read === undefined) {
    failSurface(traced.fault ?? "the surface answered the sweep with nothing");
  }
  return traced.read;
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

/**
 * The base drift speed a check poses for a wave's rocks, in units per second.
 *
 * Inside the Large range `specs/rocks.md` draws from, so the pose is an outcome the
 * draw could have decided; not one of its ends, so a build that clamps to the
 * range reads differently from one that took the pose.
 */
export const POSED_BASE_SPEED = 100;

/** What a posed wave arrived as: the wave the build reported, and its rocks' speeds. */
export interface PosedWave {
  /** The wave number the build reported for the spawn. */
  wave: number;
  /** Every rock's speed, read on the tick the wave arrived. */
  speeds: number[];
}

/**
 * Clear wave `wave - 1` by shooting, with `POSED_BASE_SPEED` posed as the base
 * drift speed of the wave that follows, and read that wave's speeds as it arrives.
 *
 * `specs/instrumentation.md` has `setNextRockSpeed` set "the base drift speed ...
 * that every rock of the next placement takes: the rocks of the next wave the game
 * spawns", with the wave's multiplier still applied over it. So the draw
 * `specs/rocks.md` makes from `60` to `110` is replaced by a known figure, and what
 * a check reads off the arrival is the multiplier alone: every rock at
 * `POSED_BASE_SPEED` times the factor `specs/progression.md` fixes for the wave.
 *
 * THE WAVE NUMBER COMES BACK BECAUSE THE FACTOR IS A FUNCTION OF IT, and the two
 * speed checks read the factor against the wave the BUILD says it spawned rather
 * than the one this posed — `wave-number-increments` is the item for the number.
 *
 * `wave` is the wave whose speeds are wanted, so the game is posed at `wave - 1`,
 * the pose is set, and the field is cleared into it. The pose goes on AFTER the
 * field is posed, because `addRock` places a rock at rest and consumes nothing,
 * and before the clear, because the placement that consumes it is the spawn the
 * clear announces.
 */
export async function posedWaveSpeeds(
  h: Harness,
  wave: number,
): Promise<PosedWave> {
  await h.debug.reset();
  await poseLiveWave(h, { wave: wave - 1 });
  await h.debug.setNextRockSpeed(POSED_BASE_SPEED);
  const cleared = await shootTheFieldClear(h);
  const arrival = await arrivedWave(h, cleared);
  return { wave: arrival.wave, speeds: arrival.rocks.map(speedOf) };
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
