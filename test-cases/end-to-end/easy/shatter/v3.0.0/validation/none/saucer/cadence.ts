// Shatter — the routes the `saucer` checks reach the saucer's own clocks by.
// CASE-PROVIDED.
//
// The saucer is the one entity in this case whose scenarios are mostly WAITS: it
// arrives on a clock (`SAUCER_FIRST_DELAY`, then a gap), it leaves on a clock
// (`SAUCER_LIFETIME`), and it fires on a clock (`SAUCER_FIRE_INTERVAL`). Most of
// this group therefore wants the same three things — open a game with the game's
// own arrival running, catch the next arrival, catch the next shot — and each of
// them is a compound the debug surface deliberately does not carry, so it is built
// once here. Each of those waits is measured in thousands of ticks and reads a
// handful of numbers, so each is swept inside the page rather than a round trip at
// a time; the section under `Sweeps that run inside the page` says why.
//
// IT LIVES IN THE GROUP RATHER THAN IN `../harness.ts` because nothing outside
// `saucer` waits on the saucer's cadence: every other group that wants a saucer
// poses one with `poseSaucer` and reads it standing still.
//
// NOT ONE FIGURE BELOW IS A BOUND. Everything here is a sampling stride, a ceiling
// on a wait, or a route; every tolerance stays in the check that asserts it,
// derived there from the figure `specs/saucer.md` fixes for it.

import { fail } from "../assert";
import { FIELD_W, SAUCER_LIFETIME } from "../constants";
import {
  HANDLE,
  failSurface,
  secondsFor,
  startPlaying,
  ticksFor,
  type Harness,
  type SaucerView,
  type ShatterSnapshot,
  type ShotView,
  type UntilResult,
} from "../harness";

/* -------------------------------------------------------------------------- */
/* Opening a game the saucer arrives into                                      */
/* -------------------------------------------------------------------------- */

/**
 * Pose a quiet, live field with the game's OWN saucer arrival running, from a
 * `reset`.
 *
 * `reset` is what puts the arrival clock back to the start of a game's cadence
 * (`specs/instrumentation.md`), which is the whole precondition of
 * `first-arrives-at-18s`: an arrival "18 seconds of game time after the game
 * begins" needs a game that has just begun. `startPlaying` then empties the field,
 * shuts the wave loop and the ship's contact test, and puts the screen on
 * `playing`, which is where `specs/saucer.md` says arrivals happen — and it shuts
 * the arrival gate too, which is why it is turned back on last. The gate is this
 * handful of checks' own requirement, so turning it on here is not a widening of
 * the isolation: it is the faculty under test.
 *
 * The field it leaves holds no rock, no bullet and no saucer, so the only thing
 * that can put a saucer on it is the build's own spawner.
 */
export async function openSaucerGame(h: Harness): Promise<void> {
  await h.debug.reset();
  await startPlaying(h);
  await h.debug.setSaucerSpawning(true);
}

/**
 * The due a check poses to bring an arrival on at once, in seconds.
 *
 * `setSaucerDue` sets the figure the gap draw decides (`specs/instrumentation.md`),
 * so a check that wants an arrival without waiting out the cadence poses a short
 * one. A quarter of a second, which is thirty ticks: long enough that a build's
 * clock has whole ticks to reach it, short enough that a tick-by-tick sweep to
 * the arrival costs nothing.
 */
export const SHORT_DUE = 0.25;

/* -------------------------------------------------------------------------- */
/* Sweeps that run inside the page                                             */
/* -------------------------------------------------------------------------- */
//
// THE SAUCER'S SCENARIOS READ A LOT OF TICKS AND ALMOST NOTHING OFF EACH ONE.
// `at-most-one-at-a-time` needs the reported saucer id on EVERY tick of two minutes
// of game time — 14 400 of them — because what it is looking for is the tick
// reporting no saucer between two visits, and a stride that stepped over that tick
// would fail a conformant build. `avoids-the-core` needs the saucer's centre every
// eight ticks of thirty-six crossings. The three aim items need the tick each of
// sixty shots was fired on. And every wait for an arrival covers eighteen to
// thirty-five seconds of game time to read one id.
//
// A CROSSING INTO THE PAGE PER SAMPLE IS WHAT COSTS, NOT THE TICKS. The simulation
// runs twelve thousand ticks in a handful of milliseconds; a round trip to ask for
// the state after each one costs a few milliseconds each, and on a host running a
// model's build under the suite it costs several times that. Sampled that way,
// these checks run for minutes and are decided by how loaded the machine was,
// which is not a verdict about a build.
//
// SO THE LOOP GOES WHERE THE STATE IS. Every `trace` helper in this file calls the
// BUILD'S OWN `advance` and the BUILD'S OWN `snapshot()` — the same two operations
// {@link Harness.skip} and {@link Harness.snapshot} call, in the same order, at the
// same stride, stopping on the same sample — and returns only what the check reads.
// Nothing is simulated here, nothing is posed here, and no tick is fabricated: what
// is saved is the round trip and nothing else. Every other check in this group
// drives through the harness, because every other check reads few enough samples to
// pay for them.
//
// A build whose surface cannot answer is reported as the surface fault it is,
// rather than as an exception thrown out of the page.

/** What a page-side sweep hands back: what it read, or why it could not read. */
interface Traced<T> {
  fault?: string;
  read?: T;
}

/** Fail with what the specification requires when a page-side sweep could not run. */
function requireTrace<T>(traced: Traced<T>): T {
  if (traced.fault !== undefined || traced.read === undefined) {
    failSurface(traced.fault ?? "the surface answered a sweep with nothing");
  }
  return traced.read;
}

/* -------------------------------------------------------------------------- */
/* Catching an arrival                                                         */
/* -------------------------------------------------------------------------- */

/** How long a wait for an arrival runs before the scenario is declared unreachable. */
const ARRIVAL_CEILING_TICKS = ticksFor(90);

/** What a caught arrival is: the saucer as first seen, and when it was seen. */
export interface Arrival {
  saucer: SaucerView;
  /** Ticks of game time from the start of the wait to the sample that caught it. */
  ticks: number;
  snapshot: ShatterSnapshot;
}

/**
 * The sweep {@link nextArrival} describes, run inside the page.
 *
 * The same sweep {@link Harness.skipUntil} would run: the state it starts from is
 * the first sample, every sample after it is a real `advance(stride)`, the last
 * stride is trimmed to the ceiling, and the sample it stops on is the first whose
 * reported saucer carries an id other than `afterId`. What comes back is what a
 * sweep through the harness comes back with — whether it hit, the ticks it took,
 * and the state at that sample.
 */
async function traceNextArrival(
  h: Harness,
  afterId: number | null,
  stride: number,
  maxTicks: number,
): Promise<UntilResult> {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
  const traced = (await h.page.evaluate(
    ([handle, spec]) => {
      const api = (window as unknown as Record<string, unknown>)[handle] as
        | {
            advance(n: number): void;
            snapshot(): { saucer: { id: number } | null | undefined };
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
        const arrived = (snapshot: {
          saucer: { id: number } | null | undefined;
        }): boolean =>
          snapshot.saucer !== null &&
          snapshot.saucer !== undefined &&
          snapshot.saucer.id !== spec.afterId;
        let snapshot = api.snapshot();
        let ticks = 0;
        while (!arrived(snapshot) && ticks < spec.maxTicks) {
          const step = Math.min(spec.stride, spec.maxTicks - ticks);
          api.advance(step);
          ticks += step;
          snapshot = api.snapshot();
        }
        return { read: { hit: arrived(snapshot), ticks, snapshot } };
      } catch (error) {
        return { fault: String(error) };
      }
    },
    [HANDLE, { afterId, stride, maxTicks }] as [
      string,
      { afterId: number | null; stride: number; maxTicks: number },
    ],
  )) as Traced<UntilResult>;
  return requireTrace(traced);
}

/**
 * Run until a saucer is on the field whose id is not `afterId`, and report it.
 *
 * The id rather than the presence, because a wait that began while the PREVIOUS
 * visit was still up would otherwise return that one: `specs/saucer.md` gives every
 * arrival a fresh id "distinct among every entity live at that moment", so a
 * different id is what makes this a different visit. `afterId` is `null` for the
 * first wait of a game, where any saucer at all is the arrival.
 *
 * `stride` is the caller's, because what a stride costs a reading differs by check:
 * the entry ROW is fixed for the first `SAUCER_WEAVE_INTERVAL` of a visit and a
 * coarse stride reads it exactly, while the entry COLUMN moves at `SAUCER_SPEED`
 * from the first tick and wants {@link closeUpFirstArrival}.
 */
export async function nextArrival(
  h: Harness,
  afterId: number | null,
  options: { stride?: number; maxTicks?: number } = {},
): Promise<Arrival> {
  const stride = options.stride ?? 1;
  const maxTicks = options.maxTicks ?? ARRIVAL_CEILING_TICKS;
  // THE SWEEP RUNS INSIDE THE PAGE, for the reason the section above states at
  // length: forty arrivals over four games is thousands of round trips, and on a
  // host also running a model's build that is what decides how long these items
  // take.
  const found = await traceNextArrival(h, afterId, stride, maxTicks);
  if (!found.hit) {
    fail(
      `a saucer arriving within ${secondsFor(maxTicks)} seconds of game time (specs/saucer.md)`,
      afterId === null
        ? "no saucer ever appeared on the field"
        : `the saucer on the field was still visit ${afterId}`,
    );
  }
  const saucer = found.snapshot.saucer;
  if (saucer === null || saucer === undefined) {
    fail("the arrival the sweep stopped on", "saucer was null");
  }
  return { saucer, ticks: found.ticks, snapshot: found.snapshot };
}

/**
 * Bring the next arrival on with a short due and catch it on the tick it is first
 * reported, whenever it comes.
 *
 * A saucer crosses at `SAUCER_SPEED` from the moment it enters, so a sweep that
 * samples every `stride` ticks reports an entry column up to `stride / TICK_HZ`
 * seconds of travel inside the edge it entered at, and `enters-at-an-edge` is a
 * check on exactly that column. So the due is posed short and every tick from
 * there is sampled: the arrival is caught on the tick it happens, and the whole
 * sweep is a handful of ticks rather than eighteen seconds of them.
 *
 * `afterId` is the saucer the field held before, or `null` for the first wait of
 * a game, as {@link nextArrival} takes it. The field must be clear of a saucer
 * when this is called: the cadence only runs while it is.
 */
export async function closeUpArrival(
  h: Harness,
  afterId: number | null,
): Promise<Arrival> {
  await h.debug.setSaucerDue(SHORT_DUE);
  return nextArrival(h, afterId, {
    stride: 1,
    maxTicks: ticksFor(SHORT_DUE) * 4,
  });
}

/** How long a wait for a departure runs before the scenario is unreachable. */
const DEPARTURE_CEILING_TICKS = ticksFor(SAUCER_LIFETIME + 1);

/**
 * Run until the field is clear of the saucer `id`, and report how long it took.
 *
 * A visit ends on its own clock, `SAUCER_LIFETIME` after it entered
 * (`specs/saucer.md`), so a sweep of a little over that always finds the field
 * clear on a conformant build; the cadence to the next arrival runs from there.
 */
export async function awaitDeparture(
  h: Harness,
  id: number,
  stride: number,
): Promise<UntilResult> {
  const left = await h.skipUntil(
    (snapshot) =>
      snapshot.saucer === null ||
      snapshot.saucer === undefined ||
      snapshot.saucer.id !== id,
    { poll: stride, maxTicks: DEPARTURE_CEILING_TICKS },
  );
  if (!left.hit) {
    fail(
      `saucer ${id} leaving the field within SAUCER_LIFETIME (${SAUCER_LIFETIME} s) of game time (specs/saucer.md)`,
      "it was still on the field a second past that",
    );
  }
  return left;
}

/** How near an edge a centre stands, across the seam, in logical units. */
export function edgeDistance(x: number): number {
  return Math.min(x, FIELD_W - x);
}

/* -------------------------------------------------------------------------- */
/* Catching a shot                                                             */
/* -------------------------------------------------------------------------- */

/** How long a wait for a shot runs before the scenario is declared unreachable. */
const SHOT_CEILING_TICKS = ticksFor(6);

/** What a caught volley is: the rounds that appeared, and the tick they appeared on. */
export interface Volley {
  /** Every enemy bullet on the field this tick that was not there the tick before. */
  fired: ShotView[];
  /** The saucer as it stood on that tick, or `null` if it had gone. */
  saucer: SaucerView | null;
  /** Ticks of game time from the start of the wait to the tick they appeared on. */
  ticks: number;
  /** Every enemy-bullet id on the field on that tick, for the next wait to compare. */
  ids: number[];
  snapshot: ShatterSnapshot;
}

/**
 * Run one tick at a time until the enemy-bullet roster gains a round it did not
 * hold the tick before, and report that tick.
 *
 * A ROUND IS NEW WHEN IT WAS NOT THERE LAST TICK, never when its id has not been
 * seen before. `specs/instrumentation.md` forbids reusing an id only "while any
 * live entity holds it", so a build whose ids come from a small pool may hand a
 * fresh round the id of one that has just expired, and a cumulative set of ids
 * would then never see it arrive.
 *
 * `leadIn` skips whole ticks before the sampling starts, for a check that wants
 * sixty shots and does not read the gaps between them: every tick it skips is
 * counted in `ticks` just the same, and a build that fires FASTER than the lead-in
 * simply has some of its rounds passed over, which changes which shots are read and
 * not what any of them is. A check whose requirement IS the gap passes no lead-in.
 */
export async function nextVolley(
  h: Harness,
  previous: readonly number[],
  options: { leadIn?: number; maxTicks?: number } = {},
): Promise<Volley> {
  const leadIn = options.leadIn ?? 0;
  const maxTicks = options.maxTicks ?? SHOT_CEILING_TICKS;

  if (leadIn > 0) await h.skip(leadIn);

  // THE SWEEP RUNS INSIDE THE PAGE, for the reason the section above states at
  // length: a tick at a time is the only sampling that cannot step over
  // a shot, and a crossing per tick makes what the three aim items cost a fact
  // about the host rather than about the build. The loop calls the BUILD's own
  // `advance(1)` and the BUILD's own `snapshot()`, in the same order a sweep
  // through the harness calls them, and stops on the same tick.
  const caught = await traceNextVolley(h, previous, maxTicks, leadIn);

  if (caught === null) {
    fail(
      `a saucer firing within ${secondsFor(maxTicks)} seconds of game time (specs/saucer.md)`,
      "no saucer bullet appeared on the field",
    );
  }
  return caught;
}

/* -------------------------------------------------------------------------- */
/* Reading every sample of a sweep                                             */
/* -------------------------------------------------------------------------- */

/**
 * Run up to `maxTicks` in strides of `stride`, handing EVERY sample to `read`, and
 * stop as soon as it says it has what it needs.
 *
 * WHY THIS AND NOT A LOOP OF `skip` AND `snapshot`. {@link Harness.skipUntil} runs
 * its strides and reads the state back in ONE crossing into the page, and it calls
 * its predicate on every sample it takes — the state it starts from included. A
 * check that wants each of those samples therefore gets them for the price of the
 * sweep by reading them there, where a loop that skipped and then asked for a
 * snapshot would pay twice for the same tick. Two checks in this group sweep tens
 * of thousands of ticks and it is the difference between them being affordable and
 * not.
 *
 * `read` returns `true` when the sweep has what it needs and `false` to carry on.
 * The result says whether it ever did.
 */
export async function sampleEvery(
  h: Harness,
  options: { stride: number; maxTicks: number },
  read: (snapshot: ShatterSnapshot) => boolean,
): Promise<boolean> {
  const swept = await h.skipUntil(read, {
    poll: options.stride,
    maxTicks: options.maxTicks,
  });
  return swept.hit;
}

/** Every moment the reported saucer id changed, and what it changed to. */
export interface VisitTrace {
  tick: number;
  id: number | null;
}

/**
 * Sample the reported `saucer.id` on EVERY tick of `ticks`, and report the moments
 * it changed. The state the sweep starts from is the first entry.
 */
export async function traceSaucerVisits(
  h: Harness,
  ticks: number,
): Promise<VisitTrace[]> {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
  const traced = (await h.page.evaluate(
    ([handle, count]) => {
      const api = (window as unknown as Record<string, unknown>)[handle] as
        | {
            advance(n: number): void;
            snapshot(): { saucer: { id: number } | null };
          }
        | undefined;
      if (
        api === undefined ||
        typeof api.advance !== "function" ||
        typeof api.snapshot !== "function"
      ) {
        return { fault: "advance and snapshot on the debug surface" };
      }
      const read = (): number | null => {
        const saucer = api.snapshot().saucer;
        return saucer === null || saucer === undefined ? null : saucer.id;
      };
      try {
        const changes: { tick: number; id: number | null }[] = [];
        let held = read();
        changes.push({ tick: 0, id: held });
        for (let tick = 1; tick <= count; tick += 1) {
          api.advance(1);
          const id = read();
          if (id !== held) {
            changes.push({ tick, id });
            held = id;
          }
        }
        return { read: changes };
      } catch (error) {
        return { fault: String(error) };
      }
    },
    [HANDLE, ticks] as [string, number],
  )) as Traced<VisitTrace[]>;
  return requireTrace(traced);
}

/**
 * Run a tick at a time until the saucer-bullet roster gains a round it did not
 * hold the tick before, and report that tick — all inside the page.
 *
 * The page-side counterpart of the sweep {@link nextVolley} describes, and the
 * same sweep: the first sample is the state it starts from and starts the
 * comparison, every tick after it is a real `advance(1)`, and the first tick
 * carrying a round the previous sample did not is the one that comes back.
 * `null` is "no round appeared inside `maxTicks`", which is the caller's failure
 * to report, not this one's.
 */
async function traceNextVolley(
  h: Harness,
  previous: readonly number[],
  maxTicks: number,
  leadIn: number,
): Promise<Volley | null> {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
  const traced = (await h.page.evaluate(
    ([handle, spec]) => {
      const api = (window as unknown as Record<string, unknown>)[handle] as
        | {
            advance(n: number): void;
            snapshot(): {
              saucer: unknown;
              enemyBullets: { id: number }[];
            };
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
        let held: number[] = [...spec.previous];
        for (let tick = 1; tick <= spec.maxTicks; tick += 1) {
          api.advance(1);
          const snapshot = api.snapshot();
          const rounds = snapshot.enemyBullets ?? [];
          const ids = rounds.map((round) => round.id);
          const fired = rounds.filter((round) => !held.includes(round.id));
          if (fired.length > 0) {
            return { read: { fired, snapshot, ids, tick } };
          }
          held = ids;
        }
        return { read: null };
      } catch (error) {
        return { fault: String(error) };
      }
    },
    [HANDLE, { previous: [...previous], maxTicks }] as [
      string,
      { previous: number[]; maxTicks: number },
    ],
  )) as Traced<{
    fired: ShotView[];
    snapshot: ShatterSnapshot;
    ids: number[];
    tick: number;
  } | null>;
  if (traced.fault !== undefined) failSurface(traced.fault);
  const read = traced.read;
  if (read === undefined || read === null) return null;
  return {
    fired: read.fired,
    saucer: read.snapshot.saucer ?? null,
    ticks: leadIn + read.tick,
    ids: read.ids,
    snapshot: read.snapshot,
  };
}

/** How a crossing is followed past the star. */
export interface PathOptions {
  /** Ticks between two samples once the saucer is inside the window. */
  stride: number;
  /** Ticks run in one step while it is still outside it. */
  approach: number;
  /** How near the star's column, in units of `x`, sampling happens at all. */
  window: number;
  /** How long the whole crossing may run before the sweep gives up on it. */
  maxTicks: number;
  /** The field's width, for the wrapped column separation. */
  fieldWidth: number;
  /** The star's column. */
  starX: number;
}

/**
 * Follow one crossing and report the saucer's centre at every `stride` ticks it
 * spent within `window` units of the star's column.
 *
 * The ground before the window is covered in `approach`-tick steps and sampled not
 * at all, because a centre more than `window` units from the star's COLUMN is at
 * least that far from the star's CENTRE — several times any bound this case
 * asserts — so nothing out there can be a closest approach. The sweep stops when
 * the saucer leaves the window on the far side, when it leaves the field, or at
 * the ceiling.
 */
export async function traceSaucerPath(
  h: Harness,
  options: PathOptions,
): Promise<{ x: number; y: number }[]> {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
  const traced = (await h.page.evaluate(
    ([handle, spec]) => {
      const api = (window as unknown as Record<string, unknown>)[handle] as
        | {
            advance(n: number): void;
            snapshot(): { saucer: { x: number; y: number } | null };
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
        const samples: { x: number; y: number }[] = [];
        let ran = 0;
        let entered = false;
        while (ran < spec.maxTicks) {
          const saucer = api.snapshot().saucer;
          if (saucer === null || saucer === undefined) break;
          const half = spec.fieldWidth / 2;
          let gap = (spec.starX - saucer.x) % spec.fieldWidth;
          if (gap >= half) gap -= spec.fieldWidth;
          if (gap < -half) gap += spec.fieldWidth;
          const inside = Math.abs(gap) <= spec.window;
          if (inside) {
            samples.push({ x: saucer.x, y: saucer.y });
            entered = true;
          } else if (entered) {
            break;
          }
          const step = inside ? spec.stride : spec.approach;
          api.advance(step);
          ran += step;
        }
        return { read: samples };
      } catch (error) {
        return { fault: String(error) };
      }
    },
    [HANDLE, options] as [string, PathOptions],
  )) as Traced<{ x: number; y: number }[]>;
  return requireTrace(traced);
}
