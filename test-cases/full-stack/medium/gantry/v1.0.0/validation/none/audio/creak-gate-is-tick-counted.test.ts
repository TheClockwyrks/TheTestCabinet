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

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { GRIP_MAX_RATE, RUN_SPEEDS } from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
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

/** Windows driven: eighty ticks, well over two whole creak cooldowns. */
const WINDOWS = 20;

/** One window of a watched run: the ticks its frames covered, and its creaks. */
interface Window {
  from: number;
  to: number;
  creaks: number;
}

/** Drive the same run at `speedIndex`, one window of run clock at a time. */
async function watch(harness: Harness, speedIndex: number): Promise<Window[]> {
  await openSite(harness, 0);
  await clearAll(harness);
  await poseCrane(harness, CRANE);
  await poseTape(harness, IDLE_TAPE);
  await addOneLoad(
    harness,
    "crate",
    LOAD_MASS,
    { x: 9, y: 2, z: 6, yaw: 0 },
    { x: 9, y: 2, z: 6, yaw: 0 },
  );
  await startRun(harness);
  await harness.debug.setSpeedIndex(speedIndex);
  assertEqual(
    (await harness.snapshot()).run.speedIndex,
    speedIndex,
    "the watch speed the run is being watched at",
  );
  await harness.cues();

  const perFrame = RUN_SPEEDS[speedIndex]!;
  const frames = WINDOW_TICKS / perFrame;
  const windows: Window[] = [];
  for (let k = 0; k < WINDOWS; k += 1) {
    await harness.debug.setLoadPhase(0, k % 2 === 1 ? "attached" : "waiting");
    const before = (await harness.snapshot()).run.tick;
    await harness.advance(frames);
    const after = await harness.snapshot();
    const played = await harness.cues();
    assertEqual(
      after.run.phase,
      "running",
      `the run still running through window ${k}`,
    );
    windows.push({
      from: before + 1,
      to: after.run.tick,
      creaks: played.filter((c) => c === "creak").length,
    });
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
  const slow = await watch(h, 0);
  await h.capture("speeds", "The same run watched at 1x and 4x");

  const fast = await createHarness();
  let quick: Window[];
  try {
    quick = await watch(fast, RUN_SPEEDS.length - 1);
  } finally {
    await fast.dispose();
  }

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
