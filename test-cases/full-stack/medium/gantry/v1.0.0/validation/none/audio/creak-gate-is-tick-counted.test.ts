// audio/creak-gate-is-tick-counted — a run's creaks fall on the same ticks at
// every watch speed.
//
// specs/ui.md § Audio, the `creak` row, of the cooldown: "The gate is a tick
// count, so a run's creaks fall on the same ticks at every watch speed."
// specs/program.md says what the watch speed is: "The player watches at any of
// `RUN_SPEEDS` (`1`, `2`, `4`) times real time; speed changes how many ticks a
// second of watching covers and nothing else."
//
// SO THE SAME RUN IS WATCHED TWICE, at index `0` and at index `2`, and the two
// readings are compared. The run is driven in windows of `RUN_SPEEDS[2]` (`4`)
// ticks, which is one frame at index `2` and four frames at index `0`, so the
// same window of RUN CLOCK is covered either way and every sound is bracketed by
// the ticks its frames covered. The check reads `run.tick` before and after each
// window and holds the two runs to the same brackets, so the comparison is
// between windows of the same ticks and not merely between windows of the same
// count.
//
// WHY THE SCHEDULE IS WHAT IT IS. The load is hung on the hook for every other
// window, so a member reaches `CREAK_THRESHOLD` from below on the first tick of
// every odd window: ticks 5, 13, 21, 29, 37 and so on, eight ticks apart. The
// cooldown is thirty ticks, so most of those crossings are suppressed and only
// some of them creak — which is exactly what makes the reading a measurement of
// the GATE rather than of the crossings. A build whose cooldown counted frames
// rather than ticks would let a quarter as many creaks through at index `2`,
// where a frame is four ticks; a build that counted seconds of watching would
// creak four times as often there. Either way the two runs disagree.
//
// HOW A CROSSING IS DRIVEN. `setLoadPhase` hangs the yard's one crate on the hook
// or takes it off between windows. The bob's mass is "the hook alone, or the hook
// with the attached load" (specs/rigging.md), so the cable tension at the trolley
// point steps between the two and the crane below puts that force into its own
// members. Nothing fabricates a utilization; the build's own solve decides it.
//
// THE TWO WATCHES ARE TWO RUNS OF ONE PAGE, one after the other. What the reading
// rests on is the build's own determinism — "the same structure and the same tape
// produce the same run, tick for tick, every time" (specs/instrumentation.md) —
// and the two runs differ in the watch speed alone. `openSite` is what parts
// them: it puts the run back to its idle placeholder and the camera back at its
// start pose while leaving the structure and the tape stored on the site, so the
// second watch is posed by re-adding the load and starting the run rather than by
// rebuilding the crane. Between them the first run is carried past its own
// cooldown, so a build holding the gate anywhere other than the run it belongs to
// cannot carry a live one into the second watch and be read as silent there for a
// reason that is not this point.
//
// EACH WINDOW COSTS THREE CALLS AND NOT FIVE. The ticks a window covered are read
// off the state the window's own frames answer with, and the window before it
// says where this one began, so nothing is asked of the surface that the drive
// already reported. The brackets are still the run's own `run.tick` either side
// of the frames rather than a count the check kept.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { GRIP_MAX_RATE, RUN_SPEEDS } from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  emptyYard,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type CraneDesign,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/**
 * A jib crane whose most-loaded members answer to the hook, and to nothing else.
 *
 * A braced tower between site 1's four ground anchors and the ring's bottom
 * flange at `y` `4`; a mast head at `(2, 10, 0)` tied to all four top-flange
 * nodes; a jib out to `(4, 6, 0)`, hung from the mast head and braced out of
 * plane; and one rail from `(4, 6, 0)` to `(6, 6, 0)`, whose two ends stand at
 * distinct horizontal distances from the slew axis, so the track's origin — where
 * the trolley begins every run (specs/structure.md) — is the jib node rather than
 * a flange node. That is the whole point of the shape: the cable force is applied
 * at the trolley point, and a trolley point out on the jib puts that force into
 * the arm's own members instead of straight into a support.
 *
 * Every node lies inside site 1's envelope and the crane costs well under its
 * budget, so it poses unrefused on an emptied yard.
 */
const CRANE: CraneDesign = {
  site: 1,
  name: "Creak jib",
  ring: [0, 4, 0],
  counterweights: [],
  members: [
    // The tower: four legs, the bottom flange square with one diagonal, and one
    // diagonal on each of the tower's four sides.
    [[0, 0, 0], [0, 4, 0], "strut"],
    [[2, 0, 0], [2, 4, 0], "strut"],
    [[0, 0, 2], [0, 4, 2], "strut"],
    [[2, 0, 2], [2, 4, 2], "strut"],
    [[0, 4, 0], [2, 4, 0], "strut"],
    [[0, 4, 2], [2, 4, 2], "strut"],
    [[0, 4, 0], [0, 4, 2], "strut"],
    [[2, 4, 0], [2, 4, 2], "strut"],
    [[0, 4, 0], [2, 4, 2], "strut"],
    [[0, 0, 0], [2, 4, 0], "strut"],
    [[0, 0, 0], [0, 4, 2], "strut"],
    [[2, 0, 0], [2, 4, 2], "strut"],
    [[0, 0, 2], [2, 4, 2], "strut"],
    // The mast, tied to all four top-flange nodes.
    [[0, 6, 0], [2, 10, 0], "strut"],
    [[2, 6, 0], [2, 10, 0], "strut"],
    [[0, 6, 2], [2, 10, 0], "strut"],
    [[2, 6, 2], [2, 10, 0], "strut"],
    // The jib node, braced in plane, out of plane, and hung from the mast.
    [[2, 6, 0], [4, 6, 0], "strut"],
    [[2, 6, 2], [4, 6, 0], "strut"],
    [[2, 10, 0], [4, 6, 0], "strut"],
    // The track, and the two ties that hold its far end up.
    [[4, 6, 0], [6, 6, 0], "rail"],
    [[2, 6, 2], [6, 6, 0], "strut"],
    [[2, 10, 0], [6, 6, 0], "cable"],
  ],
  tape: [],
};

/**
 * A tape that keeps the run going and puts no force into anything.
 *
 * specs/rigging.md: "Turning the grip applies no force to anything", and with no
 * load attached it "turns the bare hook, visibly and to no other effect". So a
 * long grip move is a run that ticks for eighty seconds while the structure
 * carries exactly what this check puts on it.
 */
const IDLE_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 3600, rate: GRIP_MAX_RATE }],
  },
];

/** The load whose weight, hung on the hook, drives a member across the threshold. */
const LOAD_MASS = 120;

/** The window the run is driven in: one frame at the fastest watch speed. */
const WINDOW_TICKS = RUN_SPEEDS[RUN_SPEEDS.length - 1]!;

/**
 * Windows driven: forty-eight ticks, over a whole creak cooldown and a half.
 *
 * A window is four ticks, so window `k` covers ticks `4k + 1` to `4k + 4`, and a
 * member reaches the threshold from below on the first tick of every odd window:
 * 5, 13, 21, 29, 37, 45. The cooldown is thirty ticks, so the crossing at 5 gets
 * through and the next one to get through is 37 — two windows apart in the
 * pattern the two watches are compared on, which is more than one, which is what
 * the check asserts it got before comparing. Driving further adds windows to both
 * watches and nothing to the comparison.
 */
const WINDOWS = 12;

/**
 * Ticks the first run is carried on before the second is posed.
 *
 * `0.52` run-clock seconds, which is past `CREAK_COOLDOWN` (`0.5`) whether a
 * build counts the gate in ticks or in the `simTime` that accumulates across
 * both runs.
 */
const DRAIN = 31;

/** One window of a watched run: the ticks its frames covered, and its creaks. */
interface Window {
  from: number;
  to: number;
  creaks: number;
}

/** Where the yard's one crate stands, well clear of the crane. */
const LOAD_AT = { x: 9, y: 2, z: 6, yaw: 0 } as const;

/** The crane and the tape both watches are driven on, stored on the open site. */
async function poseWorld(harness: Harness): Promise<void> {
  await openSite(harness, 0);
  await clearAll(harness);
  await poseCrane(harness, CRANE);
  await poseTape(harness, IDLE_TAPE);
}

/** Drive the same run at `speedIndex`, one window of run clock at a time. */
async function watch(harness: Harness, speedIndex: number): Promise<Window[]> {
  // Back to a site with no run on it, the yard emptied of the loads the site
  // opening put back, and the one load this run is about added. The structure and
  // the tape are the site's and stay as `poseWorld` left them.
  await openSite(harness, 0);
  await emptyYard(harness);
  await addOneLoad(harness, "crate", LOAD_MASS, LOAD_AT, LOAD_AT);
  await startRun(harness);
  await harness.debug.setSpeedIndex(speedIndex);
  const posed = await harness.snapshot();
  assertEqual(
    posed.run.speedIndex,
    speedIndex,
    "the watch speed the run is being watched at",
  );
  await harness.cues();

  const perFrame = RUN_SPEEDS[speedIndex]!;
  const frames = WINDOW_TICKS / perFrame;
  const windows: Window[] = [];
  let previous = posed.run.tick;
  for (let k = 0; k < WINDOWS; k += 1) {
    await harness.debug.setLoadPhase(0, k % 2 === 1 ? "attached" : "waiting");
    const after = await runTicks(harness, frames);
    const played = await harness.cues();
    assertEqual(
      after.run.phase,
      "running",
      `the run still running through window ${k}`,
    );
    windows.push({
      from: previous + 1,
      to: after.run.tick,
      creaks: played.filter((c) => c === "creak").length,
    });
    previous = after.run.tick;
  }
  return windows;
}

/** The windows a run creaked in, named by the ticks they covered. */
const sounded = (windows: readonly Window[]): string =>
  windows
    .filter((w) => w.creaks > 0)
    .map((w) => `ticks ${w.from}-${w.to}`)
    .join(", ");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creaks on the same ticks watched at 1x and at 4x", async () => {
  await poseWorld(h);

  const slow = await watch(h, 0);
  await h.capture("speeds", "The same run watched at 1x and 4x");

  // Past the first run's own cooldown, then the same run again at the fastest
  // watch speed.
  await runTicks(h, DRAIN);
  const quick = await watch(h, RUN_SPEEDS.length - 1);

  assertEqual(
    JSON.stringify(quick.map((w) => [w.from, w.to])),
    JSON.stringify(slow.map((w) => [w.from, w.to])),
    `the ticks each window covered at ${RUN_SPEEDS[RUN_SPEEDS.length - 1]}x, ` +
      "against the same run at 1x: the watch speed changes how many ticks a " +
      "frame covers and nothing else (specs/program.md)",
  );

  assertGreaterThan(
    slow.filter((w) => w.creaks > 0).length,
    1,
    "the windows the 1x run creaked in, so the cooldown gated more than one " +
      "crossing and there is a pattern to compare",
  );

  assertEqual(
    sounded(quick),
    sounded(slow),
    `the windows the run creaked in watched at ` +
      `${RUN_SPEEDS[RUN_SPEEDS.length - 1]}x, against the same run watched at ` +
      "1x: the creak gate is a tick count, so a run's creaks fall on the same " +
      "ticks at every watch speed (specs/ui.md)",
  );
});
