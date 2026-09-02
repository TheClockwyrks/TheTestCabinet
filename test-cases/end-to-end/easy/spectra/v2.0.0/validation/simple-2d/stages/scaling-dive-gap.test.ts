// stages/scaling-dive-gap — dives come round faster at a later stage.
//
// specs/stages.md, Scaling: `diveGapScale(stage)` is
// `max(0.55, 1 - 0.05 * (stage - 1))`, and it multiplies "the gap between dive
// launches" in specs/swarm.md. specs/swarm.md states that gap: the wave's first
// dive launches when its dive clock reaches `DIVE_FIRST_DELAY` (`2.0` s), and
// "each later dive" when the clock reaches "a value drawn between `DIVE_GAP_MIN`
// (`1.4`) and `DIVE_GAP_MAX` (`2.6`) seconds, multiplied by `diveGapScale(stage)`".
// The mean of that draw is 2.0 s at stage 1 and `diveGapScale(7)` — 0.70 — times
// it at stage 7.
//
// WHY STAGE SEVEN. It is inside the ramp — `diveGapScale` reaches its 0.55 floor at
// stage 10, so a later stage would assert the same figure
// `stages/scaling-dive-gap-floor` already asserts — and it is the point on the ramp
// where the wrong models sit furthest OUTSIDE the band, which is the figure that
// decides anything. `diveGapScale(7)` is 0.70, so the accepted band is
// [0.56, 0.84]: a build that does not scale the gap at all reads 1.00, 0.16 clear
// of the upper edge and better than four standard deviations of the measurement;
// one that scales at half the stated rate reads 0.85; and one already on the floor
// reads 0.55. Read at stage 5 the same 20% band spans [0.64, 0.96] and the model
// this point exists to catch — no scaling, at 1.00 — clears the EDGE by only 0.04,
// which is under one standard deviation, while a half-rate build at 0.90 sits
// inside the band altogether. Read at stage 8 the band spans [0.52, 0.78] and
// admits the 0.55 an over-scaling build reads. Seven is the only stage at which all
// three fall outside, and the distance that matters is always to the band's EDGE,
// never to its centre.
//
// WHY THE FIRST GAP IS DISCARDED. `DIVE_FIRST_DELAY` is a fixed 2.0 s that
// specs/stages.md does not scale — only "each later dive" is drawn and scaled — so
// counting the wave's opening delay as a gap would drag the stage-7 mean toward
// the stage-1 one and blunt exactly the difference under test. The reading starts
// at the FIRST launch and measures the gaps between launches after it.
//
// WHY TWENTY GAPS. The gap is a fresh uniform draw each time, with a standard
// deviation of 0.35 s about a 2.0 s mean, so a mean of few samples is mostly noise.
// Twenty gaps on each leg puts the standard deviation of the measured RATIO at
// about 0.044 against a 0.16 tolerance — better than three and a half sigma — so a
// conformant build is not failed by the draw, while a build off by a whole scale
// factor is nowhere near.
//
// WHAT IS POSED. A complete formation, every slot filled with an inert Shard, the
// wave's dive clock at 0, and the dive launcher turned on. This is the point whose
// requirement the dive gate IS, which is why it is opened here. Every drone's
// TRAVEL is off, so a launched drone holds its position and its `diving` phase —
// specs/instrumentation.md: "Off, it holds its exact centre and keeps its phase;
// nothing is cancelled, completed, or resolved early" — which is what isolates the
// CADENCE from the dive: no drone flies down the field, none returns to its slot
// to be launched a second time, and none of them fires. The clock is posed at 0 so
// each leg measures from a moment the check chose rather than from an assembly
// transition a build may or may not have.

import { afterEach, beforeEach, it } from "vitest";
import { diveGapScale, FORM_COLS, FORM_ROWS } from "../../src/constants";
import {
  assertBetween,
  assertCloseTo,
  assertGreaterThanOrEqual,
} from "../assert";
import {
  captureReplay,
  createHarness,
  poseFormation,
  seconds,
  startPosed,
  ticksFor,
  type FormationEntry,
  type Harness,
} from "../harness";

/** The stage the ramp is read at, and the stage it is read against. */
const LATE_STAGE = 7;
const BASE_STAGE = 1;

/** What specs/stages.md says the late stage's gap is, per the base stage's. */
const EXPECTED_RATIO = diveGapScale(LATE_STAGE) / diveGapScale(BASE_STAGE);

/** Gaps between launches each leg measures, after discarding the first delay. */
const GAPS = 20;

/**
 * Every slot of the grid specs/field.md fixes, filled with an inert Shard.
 *
 * The whole grid rather than a handful, so a build that launches from a chosen
 * subset of the block still has something to launch on every cadence the reading
 * counts, and so nothing about which slots are filled can shorten a leg.
 */
const FULL_FORMATION: FormationEntry[] = Array.from(
  { length: FORM_ROWS * FORM_COLS },
  (_, index) => ({
    kind: "shard" as const,
    col: index % FORM_COLS,
    row: Math.floor(index / FORM_COLS),
  }),
);

/**
 * Frames between two samples of the sweep.
 *
 * A fifth of a second. The shortest gap either leg can draw is
 * `DIVE_GAP_MIN * diveGapScale(7)` = 0.98 s, so no two launches can fall inside
 * one sample and every launch is seen. The error it puts on a single gap is at
 * most one sample either way, and it TELESCOPES across the twenty gaps a leg
 * measures — the mean gap is the span from the first launch to the last divided by
 * twenty, so only those two samples' offsets survive, and the error left on the
 * mean is under five milliseconds. It is this coarse because a sample costs a
 * snapshot and this point drives more than a minute of game time.
 */
const SAMPLE_FRAMES = ticksFor(0.2);

/**
 * Frames each leg may run before it gives up.
 *
 * The stage-1 wave's own worst case with room to spare: the 2.0 s first delay plus
 * twenty gaps of `DIVE_GAP_MAX` (`2.6` s), and half as much again. A build
 * launching on any conformant schedule finishes well inside it, and one that
 * launches nothing is reported as having launched nothing rather than hanging.
 */
const SWEEP_FRAMES = ticksFor((2.0 + GAPS * 2.6) * 1.5);

/**
 * How far the measured ratio may sit from the stated one, as a fraction.
 *
 * The manifest's own figure, and the right order for a mean of drawn values: 20% of
 * 0.70 is 0.14, three and a half times the standard deviation of the measurement,
 * so a conforming build is not failed by the draw. It is not tightened further
 * because `specs/swarm.md` fixes only the RANGE a gap is drawn from and not the
 * distribution: a build drawing the two ends of that range rather than uniformly
 * over it carries a wider spread on the same mean, and it is conformant.
 *
 * What the band has to clear is measured to its EDGE, at `EXPECTED_RATIO` * 1.2 =
 * 0.84 above and * 0.8 = 0.56 below, and every wrong model is outside it: no
 * scaling at 1.00, half the stated rate at 0.85, the floor at 0.55. See WHY STAGE
 * SEVEN above for why this stage is where that is true.
 */
const TOLERANCE = 0.2;

/**
 * Decimal places the derived dive-gap scale itself must agree to.
 *
 * Six, which is exact for this purpose: `diveGapScale(stage)` is a formula the
 * specification states to two decimals and specs/instrumentation.md has the
 * snapshot report it "derived at the call from `stage` by the formulas in
 * specs/stages.md", so the only slack a build can honestly need is the last bits
 * of a double. Reading it at the stage this point works at is what separates a
 * ramp that runs one step ahead of the stated one — a build using
 * `1 - 0.05 * stage` reads 0.65 where the specification says
 * 0.70, which the band above admits and this does not, and
 * `stages/scaling-dive-gap-floor` reads the same field only where the formula has
 * saturated and every ramp reads alike.
 */
const SCALE_DIGITS = 6;

/**
 * Launches kept as the replay this point hands the reviewer.
 *
 * Four, which is the first delay and three gaps — about seven seconds of the
 * stage-seven leg. The measurement itself needs twenty gaps and more than half a
 * minute of game time, and a replay of the whole of that would be a minute of a
 * formation that deliberately does not move. What is kept is the opening of the
 * same drive the verdict is read from.
 */
const SHOWN_LAUNCHES = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** The frames of the sweep on which a new drone entered phase `diving`. */
interface Launches {
  /** The frame each launch was seen on, in order. */
  at: number[];
  /** The drones already counted, so one is never counted twice. */
  counted: Set<number>;
  /** Frames the sweep has advanced so far. */
  frame: number;
}

/**
 * Sweep on until `target` launches have been seen, adding to what is already
 * there.
 *
 * Split in two so the replay can wrap the opening of the drive without the
 * measurement being cut short with it. `until` evaluates its predicate once before
 * it advances anything, so the first sample of each leg is the moment the leg
 * started from and adds nothing to the frame count.
 */
async function sweepToLaunches(
  harness: Harness,
  seen: Launches,
  target: number,
): Promise<void> {
  let fresh = true;
  await harness.until(
    (snapshot) => {
      if (fresh) fresh = false;
      else seen.frame += SAMPLE_FRAMES;
      for (const drone of snapshot.drones) {
        if (drone.phase !== "diving" || seen.counted.has(drone.id)) continue;
        seen.counted.add(drone.id);
        seen.at.push(seen.frame);
      }
      return seen.at.length >= target;
    },
    { maxFrames: SWEEP_FRAMES, poll: SAMPLE_FRAMES },
  );
}

/** The mean gap between launches after the first, in seconds, at `stage`. */
async function meanGap(
  harness: Harness,
  stage: number,
  outputId?: string,
): Promise<number> {
  harness.debug.reset();
  startPosed(harness);
  harness.debug.setStage(stage);
  assertCloseTo(
    harness.snapshot().diveGapScale,
    diveGapScale(stage),
    SCALE_DIGITS,
    `the dive-gap scale the game derives at stage ${String(stage)}, ` +
      "max(0.55, 1 - 0.05 * (stage - 1)) (specs/stages.md), which is the figure " +
      "the reading below has to be taken under",
  );
  poseFormation(harness, FULL_FORMATION);
  harness.debug.setDiveClock(0);
  harness.debug.setDiveLaunching(true);

  const seen: Launches = { at: [], counted: new Set(), frame: 0 };
  if (outputId !== undefined) {
    await captureReplay(harness, outputId, () =>
      sweepToLaunches(harness, seen, SHOWN_LAUNCHES),
    );
  }
  await sweepToLaunches(harness, seen, GAPS + 1);

  assertGreaterThanOrEqual(
    seen.at.length,
    GAPS + 1,
    `dive launches at stage ${String(stage)} to read ${String(GAPS)} gaps ` +
      "between (specs/swarm.md)",
  );

  let total = 0;
  for (let index = 1; index <= GAPS; index += 1) {
    total += seen.at[index] - seen.at[index - 1];
  }
  return seconds(total / GAPS);
}

it("launches stage-seven dives diveGapScale(7) times as far apart as stage-one dives", async () => {
  const base = await meanGap(h, BASE_STAGE);
  const late = await meanGap(h, LATE_STAGE, "tighter");

  assertBetween(
    late / base,
    EXPECTED_RATIO * (1 - TOLERANCE),
    EXPECTED_RATIO * (1 + TOLERANCE),
    `the mean gap between stage-${String(LATE_STAGE)} dive launches over ` +
      `stage-${String(BASE_STAGE)}'s, diveGapScale(${String(LATE_STAGE)}) ` +
      "(specs/stages.md, specs/swarm.md)",
  );
});
