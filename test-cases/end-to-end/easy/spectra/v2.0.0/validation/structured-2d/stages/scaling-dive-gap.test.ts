// stages/scaling-dive-gap — dives come round faster at a later stage.
//
// specs/stages.md, Scaling: `diveGapScale(stage)` is
// `max(0.55, 1 - 0.05 * (stage - 1))`, and it multiplies "the gap between dive
// launches" in specs/swarm.md. specs/swarm.md states that gap: the wave's first
// dive launches when its dive clock reaches `DIVE_FIRST_DELAY` (`2.0` s), and
// "each later dive" when the clock reaches "a value drawn between `DIVE_GAP_MIN`
// (`1.4`) and `DIVE_GAP_MAX` (`2.6`) seconds, multiplied by `diveGapScale(stage)`".
// At stage 7 that window is [0.98, 1.82] seconds and its middle is 1.40.
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
// THE SCALE IS READ TWICE, AND THE TWO READINGS ARE NOT THE SAME EVIDENCE.
//
//   The CADENCE is what a player lives: a complete formation, the dive clock posed
//   at 0, the dive gate opened, and the wave left to launch on its own clock. The
//   mean of twenty gaps is read against the middle of the stated window. It grades
//   that the clock runs and the launcher fires off it, and it is the drive the
//   reviewer's replay is cut from — but it is a mean over a DRAWN quantity, so the
//   band around it has to be wide enough that an honest build's draw never fails
//   it, and specs/swarm.md fixes only the window a gap is drawn FROM and not the
//   distribution over it.
//
//   The WINDOW is the bound itself, read exactly. specs/instrumentation.md gives
//   `setDiveClock` the wave's own timer — "the seconds the wave's dive timer has
//   accumulated since its last launch ... It launches nothing itself" — so posing
//   the clock just under `DIVE_GAP_MIN * diveGapScale(7)` and driving one frame
//   settles whether the gap the wave drew is at least that long, and posing it just
//   over `DIVE_GAP_MAX * diveGapScale(7)` settles whether it is at most that. Every
//   draw is bracketed that way, one hundred of them, with no mean and no
//   distribution in it at all.
//
// Neither subsumes the other. The mean cannot separate a build one step out along
// the ramp: at stage 7 it draws from [0.91, 1.69] against a stated [0.98, 1.82],
// whose means are 1.30 and 1.40 — 7% apart, well inside the spread of any
// twenty-gap mean, and a ratio against stage 1 cancels the error altogether, which
// is what this point used to rest on and no longer does. The window separates it
// on the first draw that lands under 0.98, which is about one draw in eleven, so
// over a hundred draws it is named to better than a part in ten thousand. The
// window in turn says nothing about whether the clock advances at all, which the
// cadence does.
//
// WHAT IS POSED. A complete formation, every slot filled with an inert Shard. Every
// drone's TRAVEL is off, so a launched drone holds its position and its `diving`
// phase — specs/instrumentation.md: "Off, it holds its exact centre and keeps its
// phase; nothing is cancelled, completed, or resolved early" — which is what
// isolates the CADENCE from the dive: no drone flies down the field, none returns
// to its slot to be launched a second time, and none of them fires. The window's
// probe puts each launched drone back into `formation` between draws, so the wave
// always has a full grid to choose from and no drone is ever the reason a launch
// did not happen.

import { afterEach, beforeEach, it } from "vitest";
import {
  DIVE_FIRST_DELAY,
  DIVE_GAP_MAX,
  DIVE_GAP_MIN,
  FORM_COLS,
  FORM_ROWS,
  diveGapScale,
} from "../constants";
import {
  assertBetween,
  assertCloseTo,
  assertEqual,
  assertGreaterThanOrEqual,
} from "../assert";
import {
  captureReplay,
  createHarness,
  poseFormation,
  resetTo,
  seconds,
  startPosed,
  ticksFor,
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

/** The middle of that window, which a mean over enough draws sits at: 1.40 s. */
const GAP_MEAN = (GAP_MIN + GAP_MAX) / 2;

/** Gaps the cadence measures, after discarding the wave's fixed first delay. */
const GAPS = 20;

/**
 * Draws the window brackets, one launch each.
 *
 * A hundred. A build one step out along the ramp draws from [0.91, 1.69], of which
 * the part under the stated `GAP_MIN` less the probe's own offset is about a
 * ninth, so a hundred draws leave it unnamed with probability under one in ten
 * thousand. Each draw costs two driven frames and a handful of posed fields, so a
 * hundred of them is a fraction of the cadence's own game time.
 */
const DRAWS = 100;

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
 * Every slot of the grid specs/field.md fixes, filled with an inert Shard.
 *
 * The whole grid rather than a handful, so a build that launches from a chosen
 * subset of the block still has something to launch on every cadence the reading
 * counts, and so nothing about which slots are filled can shorten a leg.
 */
function fullFormation(): FormationEntry[] {
  const entries: FormationEntry[] = [];
  for (let row = 0; row < FORM_ROWS; row += 1) {
    for (let col = 0; col < FORM_COLS; col += 1) {
      entries.push({ kind: "shard", col, row });
    }
  }
  return entries;
}

/**
 * Frames between two samples of the cadence sweep.
 *
 * A fifth of a second. The shortest gap the leg can draw is `GAP_MIN` = 0.98 s, so
 * no two launches can fall inside one sample and every launch is seen. The error it
 * puts on a single gap is at most one sample either way, and it TELESCOPES across
 * the twenty gaps measured — the mean gap is the span from the first launch to the
 * last divided by twenty, so only those two samples' offsets survive, and the error
 * left on the mean is under five milliseconds. It is this coarse because a sample
 * costs a snapshot and the cadence drives half a minute of game time.
 */
const SAMPLE_FRAMES = ticksFor(0.2);

/**
 * Frames the cadence may run before it gives up.
 *
 * The wave's own worst case with room to spare: the 2.0 s first delay plus twenty
 * gaps of `GAP_MAX`, and half as much again. A build launching on any conformant
 * schedule finishes well inside it, and one that launches nothing is reported as
 * having launched nothing rather than hanging.
 */
const SWEEP_FRAMES = ticksFor((DIVE_FIRST_DELAY + GAPS * GAP_MAX) * 1.5);

/**
 * How far the mean gap may sit from the middle of the window, as a fraction.
 *
 * The manifest's own figure, and the right order for a mean of drawn values: 20% of
 * 1.40 s is 0.28 s, three and a half times the standard deviation of a twenty-draw
 * mean over this window, so a conforming build is not failed by the draw. It is not
 * tightened further because specs/swarm.md fixes only the RANGE a gap is drawn from
 * and not the distribution: a build drawing the two ends of that range rather than
 * uniformly over it carries a wider spread on the same mean, and it is conformant.
 *
 * What the band names is measured to its EDGE, at [1.12, 1.68] seconds: a build
 * that does not scale the gap at all means 2.00 s, one scaling at half the stated
 * rate means 1.70 s, and one already on the floor means 1.10 s. The model it cannot
 * name — one step out along the ramp, at 1.30 s — is what the window brackets
 * below are for.
 */
const TOLERANCE = 0.2;

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
 * Launches kept as the replay this point hands the reviewer.
 *
 * Four, which is the first delay and three gaps — about six seconds of the drive.
 * The measurement itself needs twenty gaps and half a minute of game time, and a
 * replay of the whole of that would be a minute of a formation that deliberately
 * does not move. What is kept is the opening of the same drive the cadence is read
 * from.
 */
const SHOWN_LAUNCHES = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

/** A live stage-7 wave holding a full formation, with the dive gate open. */
function poseWave(harness: Harness): void {
  resetTo(harness);
  startPosed(harness);
  harness.debug.setStage(STAGE);
  assertCloseTo(
    harness.snapshot().diveGapScale,
    SCALE,
    SCALE_DIGITS,
    `the dive-gap scale the game derives at stage ${STAGE}, ` +
      "max(0.55, 1 - 0.05 * (stage - 1)) (specs/stages.md)",
  );
  poseFormation(harness, fullFormation());
  harness.debug.setDiveClock(0);
  harness.debug.setDiveLaunching(true);
}

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

/** The mean gap between launches after the first, in seconds. */
async function meanGap(harness: Harness): Promise<number> {
  poseWave(harness);

  const seen: Launches = { at: [], counted: new Set(), frame: 0 };
  await captureReplay(harness, "tighter", () =>
    sweepToLaunches(harness, seen, SHOWN_LAUNCHES),
  );
  await sweepToLaunches(harness, seen, GAPS + 1);

  assertGreaterThanOrEqual(
    seen.at.length,
    GAPS + 1,
    `dive launches at stage ${STAGE} to read ${GAPS} gaps ` +
      "between (specs/swarm.md)",
  );

  return seconds((seen.at[GAPS] - seen.at[0]) / GAPS);
}

/** How many drones the wave has just put into phase `diving`. */
function divers(harness: Harness): number[] {
  return harness
    .snapshot()
    .drones.filter((drone) => drone.phase === "diving")
    .map((drone) => drone.id);
}

/** Put every diver back in its slot, so the grid is full for the next draw. */
function reseat(harness: Harness, ids: readonly number[]): void {
  for (const id of ids) harness.debug.setDronePhase(id, "formation");
}

/** What bracketing `DRAWS` drawn gaps against the stated window found. */
interface Brackets {
  /** Draws that launched before the window's shortest gap could have elapsed. */
  early: number;
  /** Draws that had not launched once the window's longest gap had elapsed. */
  late: number;
}

/** Bracket every drawn gap between `GAP_MIN` and `GAP_MAX`. */
async function bracketDraws(harness: Harness): Promise<Brackets> {
  poseWave(harness);
  // The wave's FIRST gap is the fixed `DIVE_FIRST_DELAY`, which specs/stages.md
  // does not scale, so it is spent before any draw is bracketed.
  harness.debug.setDiveClock(DIVE_FIRST_DELAY + PROBE_MARGIN);
  await harness.advance(1);
  reseat(harness, divers(harness));

  const found: Brackets = { early: 0, late: 0 };
  for (let draw = 0; draw < DRAWS; draw += 1) {
    harness.debug.setDiveClock(GAP_MIN - PROBE_MARGIN);
    await harness.advance(1);
    const tooSoon = divers(harness);
    if (tooSoon.length > 0) {
      found.early += 1;
      reseat(harness, tooSoon);
    }

    harness.debug.setDiveClock(GAP_MAX + PROBE_MARGIN);
    await harness.advance(1);
    const launched = divers(harness);
    if (launched.length === 0) found.late += 1;
    reseat(harness, launched);
  }
  return found;
}

it("draws stage-seven dive gaps from the window diveGapScale(7) scales", async () => {
  const mean = await meanGap(h);
  const brackets = await bracketDraws(h);

  assertBetween(
    mean,
    GAP_MEAN * (1 - TOLERANCE),
    GAP_MEAN * (1 + TOLERANCE),
    `the mean of ${GAPS} gaps between stage-${STAGE} dive ` +
      `launches (${mean.toFixed(3)} s), the middle of ` +
      `[DIVE_GAP_MIN, DIVE_GAP_MAX] * diveGapScale(${STAGE}) = ` +
      `${GAP_MEAN.toFixed(2)} s (specs/stages.md, specs/swarm.md)`,
  );
  assertEqual(
    brackets.early,
    0,
    `of ${DRAWS} drawn stage-${STAGE} dive gaps, how many ` +
      `launched with the wave's clock still under DIVE_GAP_MIN * ` +
      `diveGapScale(${STAGE}) = ${GAP_MIN.toFixed(2)} s ` +
      "(specs/stages.md, specs/swarm.md)",
  );
  assertEqual(
    brackets.late,
    0,
    `of ${DRAWS} drawn stage-${STAGE} dive gaps, how many had ` +
      `not launched with the wave's clock past DIVE_GAP_MAX * ` +
      `diveGapScale(${STAGE}) = ${GAP_MAX.toFixed(2)} s ` +
      "(specs/stages.md, specs/swarm.md)",
  );
});
