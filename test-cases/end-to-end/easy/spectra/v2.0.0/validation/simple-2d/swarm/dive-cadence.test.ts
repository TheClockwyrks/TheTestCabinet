// swarm/dive-cadence — later dives launch DIVE_GAP_MIN..DIVE_GAP_MAX apart.
//
// specs/swarm.md, "The dive": each dive after the wave's first is launched when the
// dive clock reaches "A value drawn uniformly at random between `DIVE_GAP_MIN`
// (`1.4`) and `DIVE_GAP_MAX` (`2.6`) seconds, multiplied by `diveGapScale(stage)`",
// and the clock "returns to `0` each time a dive is launched". So every gap between
// two successive launches is a draw from that window, and the WINDOW is what this
// checks. Which value inside it any one launch draws is the build's own
// generator's, and no bound can decide it.
//
// The bounds are the ENDS of that window, each given the item's own 20% either way,
// so a build drawing from a window shifted or scaled off the specified one fails on
// the first gap that lands outside it while a build drawing honestly from the right
// window passes wherever its draws fall.
//
// THE CLOCK IS POSED JUST SHORT OF THE FIRST DELAY AND THE GATE OPENED, so the
// first dive, which is `swarm/dive-first-delay`'s to grade, goes inside a handful
// of frames and the gaps that follow it are the wave's own. The complete
// formation is posed with every faculty off: the launched drones stay where they
// are and take no part, so the wave always has drones standing to choose from
// and nothing but the launcher's own clock decides when the next one goes. The
// gaps are read between LAUNCHES — the frames on which one more drone is in
// phase `diving` — so the first delay is not counted as a gap.

import { afterEach, beforeEach, it } from "vitest";
import {
  DIVE_FIRST_DELAY,
  DIVE_GAP_MAX,
  DIVE_GAP_MIN,
  FORM_COLS,
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

/**
 * The successive gaps read.
 *
 * Two, each a draw the build made and each held to the window on its own, so a
 * build agreeing with it by accident on one gap does not agree on the next. More
 * would buy nothing but game time: a gap is up to `DIVE_GAP_MAX` of a full
 * formation, and the point costs the same on every build rather than growing
 * with a long real play.
 */
const GAPS = 2;

/**
 * Where the wave's dive clock is posed when the gate opens, in seconds.
 *
 * A tenth of a second short of `DIVE_FIRST_DELAY`, so the first launch — which
 * `swarm/dive-first-delay` grades and which is not counted as a gap here — comes
 * inside a handful of frames rather than after two seconds of a full formation.
 * Every gap read after it is one the wave drew and ran out on its own clock, and
 * the point costs the same on every build rather than growing with the play it
 * would otherwise sit through.
 */
const FIRST_LEAD = 0.1;
const FIRST_CLOCK = DIVE_FIRST_DELAY - FIRST_LEAD;

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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("keeps every gap between successive dive launches inside the drawn window", async () => {
  startPosed(h);
  poseFormation(h, BLOCK);
  h.debug.setDiveClock(FIRST_CLOCK);
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
