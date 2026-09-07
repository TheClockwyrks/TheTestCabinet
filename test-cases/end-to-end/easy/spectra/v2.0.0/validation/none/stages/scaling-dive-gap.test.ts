// stages/scaling-dive-gap — dives come round faster at a later stage.
//
// specs/stages.md, Scaling: `diveGapScale(stage)` is
// `max(0.55, 1 - 0.05 * (stage - 1))`, and it multiplies "the gap between dive
// launches" in specs/swarm.md. specs/swarm.md states that gap: the wave's first
// dive launches when its dive clock reaches `DIVE_FIRST_DELAY` (`2.0` s), and
// "each later dive" when the clock reaches "a value drawn uniformly at random
// between `DIVE_GAP_MIN` (`1.4`) and `DIVE_GAP_MAX` (`2.6`) seconds, multiplied by
// `diveGapScale(stage)`".
// At stage 7 that window is [0.98, 1.82] seconds.
//
// WHY THE EXPECTATION IS NOT THE BUILD'S OWN FORMULA. `diveGapScale` is read from
// this project's own `constants.ts`, which restates the ramp from specs/stages.md,
// rather than from the build's `src/constants.ts`. A build writes that file itself
// and may still draw its gaps against a formula of its own.
//
// WHY STAGE SEVEN. It is inside the ramp — `diveGapScale` reaches its 0.55 floor at
// stage 10, where this item would assert the same figure
// `stages/scaling-dive-gap-floor` already asserts — and it is far enough along it
// that every wrong model is well clear of the stated window.
//
// THE GAP IS READ TWICE, AND THE TWO READINGS ARE NOT THE SAME EVIDENCE.
//
//   THE DRAWN FIGURE ITSELF. specs/instrumentation.md reports the wave's own
//   `diveGap`, "the figure that timer must reach for the next dive to launch",
//   which each launch redraws by the rule specs/swarm.md states. It is the wave's
//   state rather than a declaration kept beside it — the launcher is waiting on
//   exactly this number — so posing the clock past the window's top and driving one
//   frame launches a dive, redraws the gap, and hands the reading the figure the
//   build drew, EXACTLY, with no mean and no distribution in it at all. A hundred
//   draws are read that way.
//
//   THE CADENCE THE DRAWN FIGURE PRODUCES. The reading above is worth nothing on
//   its own: a build could report a well-drawn gap and launch off something else
//   entirely. So the wave is also left to run on its own clock, and the seconds
//   between two launches are measured against the `diveGap` the wave was carrying
//   when the leg opened. That is the drive a player lives, it is what the
//   reviewer's replay is cut from, and it is what ties the figure above to the
//   behaviour it is supposed to describe.
//
// Neither subsumes the other. The drawn figure says nothing about whether the
// clock advances at all, or whether the launcher waits for the figure it drew,
// which the cadence does; the cadence, over two drawn gaps, cannot tell a window
// from one a step along the ramp, which the drawn figures do the moment one lands
// outside the stated window. The draws are a small sample: each is held to the
// window and nothing is inferred from their spread, so a build drawing from a
// wider window is named by the first draw that lands outside it, and a window
// whose every draw sits inside the stated one is the reviewer's to judge from the
// replay rather than a figure this point measures.
//
// THE CADENCE OPENS ON A POSED GAP. specs/instrumentation.md gives `setDiveGap` the
// figure the clock must reach, and the first leg poses it at `GAP_MIN` exactly:
// inside the window specs/swarm.md allows, and a value a uniform draw over that
// window produces with probability zero, so a wave that launches there launched off
// the figure it was handed rather than one of its own. Every later leg runs on a
// gap the build DREW, and each is held to the figure the wave reported before the
// leg began.
//
// WHAT IS POSED. A block of two full rows, every slot filled with an inert Shard.
// Every drone's TRAVEL is off, so a launched drone holds its position and its
// `diving` phase — specs/instrumentation.md: "Off, it holds its exact centre and
// keeps its phase; nothing is cancelled, completed, or resolved early" — which is
// what isolates the CADENCE from the dive: no drone flies down the field, none
// returns to its slot to be launched a second time, and none of them fires. The
// cadence leaves its three divers where they are, which still leaves fifteen of
// the block's eighteen standing; each of the draws puts its own diver back into
// `formation` before the next, so the block is whole for every one of them and no
// drone is ever the reason a launch did not happen.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertCloseTo,
  assertEqual,
  assertGreaterThanOrEqual,
  assertTrue,
} from "../assert";
import {
  DIVE_FIRST_DELAY,
  DIVE_GAP_MAX,
  DIVE_GAP_MIN,
  FORM_COLS,
  diveGapScale,
} from "../constants";
import {
  captureReplay,
  createHarness,
  framesFor,
  poseFormation,
  seconds,
  startPosed,
  type FormationEntry,
  type Harness,
} from "../harness";

/** The stage the ramp is read at. */
const STAGE = 7;

/** What specs/stages.md multiplies the drawn gap by there: 0.70. */
const SCALE = diveGapScale(STAGE);

/** The window a gap is drawn from at that stage, in seconds: [0.98, 1.82]. */
const GAP_MIN = DIVE_GAP_MIN * SCALE;
const GAP_MAX = DIVE_GAP_MAX * SCALE;

/**
 * Drawn gaps read off the wave, one launch each.
 *
 * Two dozen, which is a sample and not a measurement: each is read EXACTLY and
 * held to the window on its own, so the count is how many draws are looked at
 * rather than a figure any band is sized from. A build drawing from a wider
 * window is named by the first draw that lands outside the stated one, and a
 * draw that varies at all across two dozen shows at least two distinct figures.
 * Each draw costs two driven frames and a handful of posed fields.
 */
const DRAWS = 24;

/**
 * The distinct figures the drawn gaps must show among them.
 *
 * Two. specs/swarm.md draws each gap "uniformly at random" over the window, so a
 * wave that reports the same gap for every launch is not drawing one; and two is
 * where "varies" begins, so a build that draws is never failed on chance.
 */
const DISTINCT_MIN = 2;

/**
 * Drawn gaps the wave is left to run out on its own clock.
 *
 * Two, after the posed one the cadence opens on. Each is held to the figure the
 * wave reported, which is an EXACT reading rather than a sample of a distribution,
 * so the count is not a sample size: what more of them would buy is more of the
 * same exact agreement, at up to `GAP_MAX` of game time each. Two is enough that
 * a build agreeing by accident on one gap does not agree on the next, and it
 * keeps the whole drive inside five seconds of game time, so the point costs the
 * same on every build rather than growing with a long real play.
 */
const DRIVEN_GAPS = 2;

/**
 * How far outside the stated window each bracket is posed, in seconds.
 *
 * Two frames of the suite's clock. The lower bracket poses the wave's timer at
 * `GAP_MIN - PROBE_MARGIN` and drives one frame, which carries the timer to
 * `GAP_MIN` less one frame: still short of the shortest gap the specification
 * allows, so a conforming build cannot launch on it however it rounds, and no
 * conforming build is ever failed by it. The upper bracket poses
 * `GAP_MAX + PROBE_MARGIN`, past the longest gap the specification allows, so a
 * conforming build always launches on it.
 */
const PROBE_MARGIN = seconds(2);

/**
 * How far a measured gap may sit from the figure the wave was waiting on, in
 * seconds.
 *
 * Two frames of the suite's clock, which is the reading's own resolution rather
 * than a tolerance on the rule. A launch lands on a whole frame, so the clock
 * crosses the figure somewhere inside a frame and the launch is seen at the end of
 * it; and specs/swarm.md fixes when the clock reaches the figure without fixing
 * where in a frame's update the wave tests it, so a build that tests before it
 * integrates is one frame the other way. Two frames covers both and nothing else:
 * it is 2% of the shortest gap the window allows.
 */
const LAUNCH_SLACK = seconds(2);

/**
 * Decimal places the derived dive-gap scale itself must agree to.
 *
 * Six, which is exact for this purpose: `diveGapScale(stage)` is a formula the
 * specification states to two decimals and specs/instrumentation.md has the
 * snapshot report it "derived at the call from `stage` by the formulas in
 * specs/stages.md", so the only slack a build can honestly need is the last bits of
 * a double. This is the REPORTED figure, a requirement of its own rather than the
 * evidence the two readings rest on.
 */
const SCALE_DIGITS = 6;

/**
 * Frames the cadence may run before it gives up.
 *
 * The wave's own worst case with room to spare: the posed opening gap plus
 * `DRIVEN_GAPS` at the longest the window allows, and half as much again. A build
 * launching on any conformant schedule finishes well inside it, and one that
 * launches nothing is reported as having launched nothing rather than hanging.
 */
const SWEEP_FRAMES = framesFor((GAP_MIN + DRIVEN_GAPS * GAP_MAX) * 1.5);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

/**
 * The block the launcher chooses from: two full rows of the grid, every drone an
 * inert Shard.
 *
 * A block of drones resting in their slots is the situation specs/swarm.md
 * launches a dive out of, and eighteen is several times the launches this point
 * counts, so the wave always has drones standing to choose from and nothing about
 * which slots are filled can move a launch. The rest of the grid would add
 * nothing to the reading and a drawn drone to every frame of the drive.
 */
const BLOCK_ROWS = [0, 1] as const;
const BLOCK: FormationEntry[] = BLOCK_ROWS.flatMap((row) =>
  Array.from({ length: FORM_COLS }, (_, col) => ({
    kind: "shard" as const,
    col,
    row,
  })),
);

/** A live stage-7 wave holding the block, with the dive gate open. */
async function poseWave(h: Harness): Promise<void> {
  await h.debug.reset();
  await startPosed(h, { stage: STAGE });
  assertCloseTo(
    (await h.snapshot()).diveGapScale,
    SCALE,
    SCALE_DIGITS,
    `the dive-gap scale the game derives at stage ${STAGE}, ` +
      "max(0.55, 1 - 0.05 * (stage - 1)) (specs/stages.md)",
  );
  await poseFormation(h, BLOCK);
  await h.debug.setDiveClock(0);
  await h.debug.setDiveLaunching(true);
}

/** One leg of the cadence: the gap the wave was waiting on, and what it ran. */
interface Leg {
  /** The wave's own `diveGap` when the leg opened, in seconds. */
  waited: number;
  /** The seconds that elapsed before the next launch, or `null` for none. */
  measured: number | null;
}

/** What one frame of the cadence is read for. */
interface Beat {
  /** Drones in phase `diving` at that frame. */
  diving: number;
  /** The figure the wave's clock is racing, in seconds. */
  gap: number;
}

/**
 * The wave's cadence: one posed gap, then `DRIVEN_GAPS` the build drew.
 *
 * Nothing is posed once the drive opens. The clock is the wave's own, and what is
 * read is one `Beat` per frame — the frames a launch lands on, and the figure the
 * wave was waiting on when each leg began.
 *
 * THE WHOLE DRIVE RUNS IN ONE CROSSING. It is some six hundred frames with a
 * reading after each, and taken a round trip apart that is six hundred crossings
 * into the page for a reading that is the build's own however the host was loaded
 * — a round trip's cost is a fact about how busy the host is, and a check that spends
 * six hundred of them has made how busy the host was part of its verdict.
 * `samples` runs the same frames, one `advance(dt, 1)` each, with the reading
 * taken inside the page, and it stops on the frame the last launch lands on.
 */
async function driveCadence(h: Harness): Promise<Leg[]> {
  await poseWave(h);
  await h.debug.setDiveGap(GAP_MIN);

  const { samples } = await captureReplay(h, "tighter", () =>
    h.samples<Beat, number>(SWEEP_FRAMES, {
      project: (snapshot) => ({
        diving: snapshot.drones.filter((drone) => drone.phase === "diving")
          .length,
        gap: snapshot.diveGap,
      }),
      argument: DRIVEN_GAPS + 1,
      stop: (_sample, taken, wanted) => {
        let launches = 0;
        for (let index = 1; index < taken.length; index += 1) {
          if (taken[index].diving > taken[index - 1].diving) launches += 1;
        }
        return launches >= wanted;
      },
    }),
  );

  const legs: Leg[] = [];
  let opened = 0;
  for (let index = 1; index < samples.length; index += 1) {
    if (samples[index].diving <= samples[index - 1].diving) continue;
    legs.push({
      waited: samples[opened].gap,
      measured: seconds(index - opened),
    });
    opened = index;
  }
  if (legs.length <= DRIVEN_GAPS) {
    legs.push({ waited: samples[opened].gap, measured: null });
  }
  return legs;
}

/** What reading `DRAWS` drawn gaps off the wave found. */
interface Draws {
  /** Each drawn gap the wave reported, in seconds. */
  gaps: number[];
  /** Draws that launched before the window's shortest gap could have elapsed. */
  early: number;
  /** Draws that had not launched once the window's longest gap had elapsed. */
  late: number;
}

/** What one round of the probe read off the state its frame left. */
interface Round {
  /** The drones in phase `diving` after that frame. */
  divers: number[];
  /** The figure the wave's clock is racing, in seconds. */
  gap: number;
}

/**
 * Read `DRAWS` drawn gaps off the wave, bracketing each launch as it goes.
 *
 * THE WHOLE PROBE RUNS IN ONE CROSSING. Each round is the same three beats — put
 * the drones the round before it launched back in their slots, pose the wave's
 * timer at one edge of the stated window, drive the one frame that settles whether
 * the build launched on it — and `DRAWS` draws is two hundred of them. Driven a
 * round trip apart that is some eight hundred crossings into the page for a
 * reading that is the build's own however the host was loaded, and a round trip's
 * cost is a fact about how busy the host is: a check that spends eight hundred of them
 * has made how busy the host was part of its verdict. `trials` runs the same
 * beats, the same frames and the same posed fields, with the arranging and the
 * reading done inside the page.
 *
 * The two brackets alternate, an even round posing the window's lower edge and an
 * odd round its upper, so `DRAWS * 2` rounds is `DRAWS` draws bracketed on both
 * sides and `DRAWS` launches to read a fresh gap off. Each round reseats whatever
 * the round before it launched, which is what keeps the grid full, so no draw
 * fails to launch for want of a drone.
 */
async function readDraws(h: Harness): Promise<Draws> {
  await poseWave(h);
  // The wave's FIRST gap is the fixed `DIVE_FIRST_DELAY`, which `specs/stages.md`
  // does not scale, so it is spent before any draw is read.
  await h.debug.setDiveClock(DIVE_FIRST_DELAY + PROBE_MARGIN);
  await h.advance(1);
  // And the drone that first delay launched goes back in its slot before the
  // first bracket reads, so what a round sees diving is what that round's own
  // frame launched and never a leftover of the frame before the probe opened.
  const spent = await h.snapshot();
  await h.pose(
    spent.drones
      .filter((drone) => drone.phase === "diving")
      .map((drone) => ["setDronePhase", drone.id, "formation"] as const),
  );

  // The reading is named rather than inferred: it appears both as what `read`
  // hands back and as what the NEXT round's `stage` is given, and a type in both
  // places is not one TypeScript can work out from the calls alone.
  const { readings } = await h.trials<Round, { low: number; high: number }>(
    DRAWS * 2,
    {
      stage: (round, last, edges) => [
        ...(last?.divers ?? []).map(
          (id) => ["setDronePhase", id, "formation"] as const,
        ),
        ["setDiveClock", round % 2 === 0 ? edges.low : edges.high] as const,
      ],
      read: (snapshot) => ({
        divers: snapshot.drones
          .filter((drone) => drone.phase === "diving")
          .map((drone) => drone.id),
        gap: snapshot.diveGap,
      }),
      argument: { low: GAP_MIN - PROBE_MARGIN, high: GAP_MAX + PROBE_MARGIN },
      operations: ["setDronePhase", "setDiveClock"],
    },
  );

  const found: Draws = { gaps: [], early: 0, late: 0 };
  for (const [round, reading] of readings.entries()) {
    // An even round posed the window's lower edge, where a conforming build has
    // not launched yet; an odd round posed its upper, where one always has, and
    // the launch it made redrew the gap the wave now reports.
    if (round % 2 === 0) {
      if (reading.divers.length > 0) found.early += 1;
    } else if (reading.divers.length === 0) {
      found.late += 1;
    } else {
      found.gaps.push(reading.gap);
    }
  }
  return found;
}

it("draws stage-seven dive gaps from the window diveGapScale(7) scales", async () => {
  const legs = await driveCadence(harness);
  const draws = await readDraws(harness);

  for (const [index, leg] of legs.entries()) {
    const posed = index === 0;
    assertTrue(
      leg.measured !== null,
      `a stage-${STAGE} dive launched inside ${SWEEP_FRAMES} frames of the ` +
        `wave's clock reaching diveGap = ${leg.waited.toFixed(3)} s ` +
        "(specs/swarm.md)",
    );
    if (!posed) {
      assertBetween(
        leg.waited,
        GAP_MIN,
        GAP_MAX,
        `the gap the wave drew for stage-${STAGE} dive ${index} (diveGap), ` +
          "within [DIVE_GAP_MIN, DIVE_GAP_MAX] * " +
          `diveGapScale(${STAGE}) = ` +
          `[${GAP_MIN.toFixed(2)}, ${GAP_MAX.toFixed(2)}] s ` +
          "(specs/stages.md, specs/swarm.md)",
      );
    }
    assertBetween(
      leg.measured ?? 0,
      leg.waited - LAUNCH_SLACK,
      leg.waited + LAUNCH_SLACK,
      `the seconds the wave ran before stage-${STAGE} dive ${index} launched, ` +
        `against the ${posed ? "posed" : "drawn"} diveGap it was waiting on ` +
        `(${leg.waited.toFixed(3)} s) (specs/swarm.md)`,
    );
  }

  assertEqual(
    draws.gaps.length,
    DRAWS,
    `stage-${STAGE} dive gaps read off the wave, one drawn per launch ` +
      "(specs/swarm.md)",
  );
  for (const [index, gap] of draws.gaps.entries()) {
    assertBetween(
      gap,
      GAP_MIN,
      GAP_MAX,
      `drawn stage-${STAGE} dive gap ${index} (diveGap), within ` +
        `[DIVE_GAP_MIN, DIVE_GAP_MAX] * diveGapScale(${STAGE}) = ` +
        `[${GAP_MIN.toFixed(2)}, ${GAP_MAX.toFixed(2)}] s ` +
        "(specs/stages.md, specs/swarm.md)",
    );
  }
  assertGreaterThanOrEqual(
    new Set(draws.gaps).size,
    DISTINCT_MIN,
    `the distinct figures among the ${DRAWS} stage-${STAGE} dive gaps the wave ` +
      "drew, each drawn uniformly at random over the window (specs/swarm.md)",
  );
  assertEqual(
    draws.early,
    0,
    `of ${DRAWS} drawn stage-${STAGE} dive gaps, how many ` +
      `launched with the wave's clock still under DIVE_GAP_MIN * ` +
      `diveGapScale(${STAGE}) = ${GAP_MIN.toFixed(2)} s ` +
      "(specs/stages.md, specs/swarm.md)",
  );
  assertEqual(
    draws.late,
    0,
    `of ${DRAWS} drawn stage-${STAGE} dive gaps, how many had ` +
      `not launched with the wave's clock past DIVE_GAP_MAX * ` +
      `diveGapScale(${STAGE}) = ${GAP_MAX.toFixed(2)} s ` +
      "(specs/stages.md, specs/swarm.md)",
  );
});
