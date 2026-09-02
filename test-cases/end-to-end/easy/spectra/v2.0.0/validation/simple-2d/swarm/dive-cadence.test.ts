// swarm/dive-cadence — later dives launch DIVE_GAP_MIN..DIVE_GAP_MAX apart.
//
// specs/swarm.md, "The dive": each dive after the wave's first is launched when the
// dive clock reaches "A value drawn between `DIVE_GAP_MIN` (`1.4`) and
// `DIVE_GAP_MAX` (`2.6`) seconds, multiplied by `diveGapScale(stage)`", and the
// clock "returns to `0` each time a dive is launched". So every gap between two
// successive launches is a draw from that window, and the window is what this
// checks — not the draw, which is the build's own generator's.
//
// The bounds are the ENDS of that window, each given the item's own 20% either way,
// so a build drawing from a window shifted or scaled off the specified one fails on
// the first gap that lands outside it while a build drawing honestly from the right
// window passes wherever its draws fall.
//
// THE CLOCK IS POSED AT `0` AND THE GATE OPENED, exactly as
// `swarm/dive-first-delay` poses it and for the same reason, and the complete
// formation is posed with every faculty off: the launched drones stay where they
// are and take no part, so the wave always has drones standing to choose from and
// nothing but the launcher's own clock decides when the next one goes. The gaps are
// read between LAUNCHES — the frames on which one more drone is in phase `diving` —
// so the first delay is not counted as a gap.

import { afterEach, beforeEach, it } from "vitest";
import {
  DIVE_FIRST_DELAY,
  DIVE_GAP_MAX,
  DIVE_GAP_MIN,
  FORM_COLS,
  FORM_ROWS,
  diveGapScale,
} from "../constants";
import { assertBetween, assertTrue } from "../assert";
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

/** The stage the formation is posed at: the first, where diveGapScale is 1. */
const STAGE = 1;

/** The item's own 20% on each end of the window the gap is drawn from. */
const GAP_TOLERANCE = 0.2;

/** The window a gap must fall in, in seconds, at the stage posed. */
const GAP_MIN = DIVE_GAP_MIN * diveGapScale(STAGE) * (1 - GAP_TOLERANCE);
const GAP_MAX = DIVE_GAP_MAX * diveGapScale(STAGE) * (1 + GAP_TOLERANCE);

/** The successive gaps read: enough that one wrong draw cannot hide. */
const GAPS = 3;

/** How long the first launch is waited for: twice DIVE_FIRST_DELAY. */
const FIRST_FRAMES = ticksFor(2 * DIVE_FIRST_DELAY);

/**
 * How long each later launch is waited for, in frames.
 *
 * Twice the window's upper end, so a build launching too slowly to pass is still
 * SEEN launching and its gap is reported as the figure it really ran.
 */
const GAP_FRAMES = ticksFor(2 * DIVE_GAP_MAX * diveGapScale(STAGE));

/**
 * Every slot of the grid specs/field.md fixes, filled with an inert Shard.
 *
 * The whole grid rather than a handful, so a build that launches from a chosen
 * subset of the block still has something to launch on every cadence the reading
 * counts, and so nothing about which slots are filled can stretch a gap.
 */
const FULL_FORMATION: FormationEntry[] = Array.from(
  { length: FORM_ROWS * FORM_COLS },
  (_, index) => ({
    kind: "shard" as const,
    col: index % FORM_COLS,
    row: Math.floor(index / FORM_COLS),
  }),
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps every gap between successive dive launches inside the drawn window", async () => {
  startPosed(h);
  poseFormation(h, FULL_FORMATION);
  h.debug.setDiveClock(0);
  h.debug.setDiveLaunching(true);

  const launches: { frames: number; hit: boolean }[] = [];
  await captureReplay(h, "cadence", async () => {
    for (let index = 0; index <= GAPS; index += 1) {
      const before = h
        .snapshot()
        .drones.filter((drone) => drone.phase === "diving").length;
      const swept = await h.until(
        (snapshot) =>
          snapshot.drones.filter((drone) => drone.phase === "diving").length >
          before,
        { maxFrames: index === 0 ? FIRST_FRAMES : GAP_FRAMES, poll: 1 },
      );
      launches.push({ frames: swept.frames, hit: swept.hit });
    }
  });

  for (const [index, launch] of launches.entries()) {
    if (index === 0) continue;
    assertTrue(
      launch.hit,
      `dive ${String(index + 1)} launched within ` +
        `${String(seconds(GAP_FRAMES))}s of dive ${String(index)} ` +
        `(specs/swarm.md)`,
    );
    assertBetween(
      seconds(launch.frames),
      GAP_MIN,
      GAP_MAX,
      `the seconds between dive ${String(index)} and dive ` +
        `${String(index + 1)}, against DIVE_GAP_MIN..DIVE_GAP_MAX ` +
        `(${String(DIVE_GAP_MIN)}..${String(DIVE_GAP_MAX)}) times ` +
        `diveGapScale(${String(STAGE)}) (${String(diveGapScale(STAGE))}) with ` +
        `the item's 20% either way (specs/swarm.md)`,
    );
  }
});
