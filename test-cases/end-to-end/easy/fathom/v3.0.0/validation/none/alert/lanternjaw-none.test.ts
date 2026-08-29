// alert/lanternjaw-none — the Lanternjaw fires no alert.
//
// `specs/predators.md` gives the alert to two hunters and withholds it from the
// third: "The moment a Gloamfin or a Flarefish acquires a fix it was not already
// chasing on, it fires a detection alert", and "The Lanternjaw fires no alert. It
// carries a standing tell of its own instead, and its file defines it, so its
// `alert` is false at every moment."
//
// AN ABSENCE HAS TO BE READ AT THE MOMENT IT WOULD OTHERWISE HAVE HAPPENED. A
// Lanternjaw that never sees the forager reports `alert` false trivially, and a
// build that fires one on every acquisition would pass a check like that. So the
// scenario earns a real acquisition through the build's own light sense and then
// watches the whole window an alert would have run for — `ALERT_TIME` (0.5 s) —
// sampling every few ticks, so a flash that came up and went down between two
// reads is still caught.
//
// THE PAIR STANDS SEVEN TILES APART, 224 units: inside the 320 a Lanternjaw
// reaches at `G = 1`, so the fix is earned rather than posed, and far enough that
// the hunter cannot cross the gap and take a life while the window is being
// watched.
//
// THE BOARD HOLDS THE LANTERNJAW AND NOTHING ELSE. `poseSightLine` empties it and
// this check spawns back the one hunter it is about, so no second predator can
// wander into the window being watched and no plankton can be eaten under the
// brightness that earns the fix.
//
// AND THE FIX HAS TO HAPPEN. A build whose Lanternjaw never acquires has no
// acquisition for an alert to have been absent from, so the absence means
// nothing and the check FAILS rather than passing on it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { ALERT_TIME, BRIGHT_HOLD } from "../constants";
import { poseSightLine, spawnPredator } from "../fixtures";
import {
  captureReplay,
  createHarness,
  seconds,
  ticks,
  type Harness,
  startPlaying,
} from "../harness";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";

/** How far apart the pair stands, in tiles. See the header. */
const GAP_TILES = 7;

/** Spare corridor beyond each of them, so neither is posed against rock. */
const LEAD_TILES = 1;
const TAIL_TILES = 2;

/** The brightness the fix is earned at, which `setBrightness` holds steady. */
const BRIGHT_G = 1;

/**
 * How long the fix is given to be taken, in ticks.
 *
 * A tenth of a second, a hard bound: the forager is fully lit and squarely in
 * reach, so a Lanternjaw that has not acquired inside it has not acquired.
 */
const FIX_TICKS = ticks(0.1);

/** How far past the window the watch runs, in seconds. See below. */
const WATCH_MARGIN = 0.2;

/**
 * How long `alert` is watched after the acquisition, in ticks.
 *
 * `ALERT_TIME` and a fifth of a second past it: the whole window an alert would
 * run for, plus room either side of it, so a build that fires one late or holds
 * one long is caught rather than missed. Summed in ticks rather than in seconds
 * so the count is whole however long the window is.
 */
const WATCH_TICKS = ticks(ALERT_TIME) + ticks(WATCH_MARGIN);

/**
 * How often `alert` is read, in ticks.
 *
 * Every three ticks, a fortieth of a second. Fine enough that no flash a reviewer
 * would see on screen can pass between two samples.
 */
const WATCH_POLL = 3;

/** Ticks run after the readings, purely so the clip shows the charge. */
const CLIP_TICKS = 36;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("The Lanternjaw fires no alert", async () => {
  await startPlaying(h);
  const line = await poseSightLine(h, GAP_TILES, {
    lead: LEAD_TILES,
    tail: TAIL_TILES,
  });
  const index = await spawnPredator(h, "lanternjaw", line.pred, {
    state: "wander",
  });
  await parkForager(h, line.forager);
  await h.debug.setBrightness(BRIGHT_G);
  await h.debug.setBrightHold(BRIGHT_HOLD);
  const guard = await sceneGuard(h);

  const read = await captureReplay(h, "none", async () => {
    // Sampled from before the acquisition, so a build that fires on the tick it
    // takes the fix is caught as surely as one that fires a beat later.
    const seen: { at: number; alert: boolean; state: string }[] = [];
    const sample = async (at: number): Promise<void> => {
      const p = (await h.snapshot()).predators[index];
      seen.push({ at, alert: p.alert, state: p.state });
    };
    await sample(0);
    const fixed = await h.until((s) => s.predators[index].state === "chase", {
      maxTicks: FIX_TICKS,
      poll: 1,
    });
    let spent = fixed.ticks;
    await sample(spent);
    for (let step = 0; step < WATCH_TICKS; step += WATCH_POLL) {
      await h.advance(WATCH_POLL);
      spent += WATCH_POLL;
      await sample(spent);
    }
    await h.advance(CLIP_TICKS);
    return { fixed, seen, end: await h.snapshot() };
  });

  requireSceneHeld(read.end, guard);

  // The acquisition happened, which is what makes the absence below a reading.
  assertEqual(
    read.seen.some((one) => one.state === "chase"),
    true,
    "the Lanternjaw is seen holding a fix inside the window that was watched, " +
      "on a fully lit forager seven tiles away on a clear line",
  );
  const fired = read.seen.filter((one) => one.alert);
  assertTrue(
    fired.length === 0,
    "every reading of the Lanternjaw's alert across the acquisition and the " +
      `${seconds(WATCH_TICKS).toFixed(2)} s after it is false — it read true at ` +
      `${fired.map((one) => `${seconds(one.at).toFixed(3)} s`).join(", ") || "no sample"}`,
  );
});
