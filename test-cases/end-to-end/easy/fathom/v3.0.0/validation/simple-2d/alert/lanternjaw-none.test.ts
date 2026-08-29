// alert/lanternjaw-none — the Lanternjaw fires no alert.
//
// specs/predators.md gives the alert to two hunters and withholds it from the
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
// WHAT THIS DOES NOT DECIDE. Whether the Lanternjaw acquires at all is
// `lanternjaw/light-range`'s, so a build whose hunter never takes a fix stands this
// check down rather than passing it on an absence that means nothing.

import { afterEach, beforeEach, it } from "vitest";
import { ALERT_TIME, BRIGHT_HOLD } from "../../src/constants";
import { assertEqual, assertTrue } from "../assert";
import { poseSightLine, spawnPredator } from "../fixtures";
import {
  captureReplay,
  createHarness,
  poseBrightness,
  seconds,
  startPlaying,
  ticks,
  type Harness,
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
 * A tenth of a second, a hard bound. Whether it is taken at all is
 * `lanternjaw/light-range`'s verdict, so a miss stands this check down.
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

afterEach(() => {
  h?.dispose();
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
  await poseBrightness(h, BRIGHT_G, BRIGHT_HOLD);
  const watch = await sceneGuard(h);

  const read = await captureReplay(h, "none", async () => {
    // Sampled from before the acquisition, so a build that fires on the tick it
    // takes the fix is caught as surely as one that fires a beat later.
    const seen: { at: number; alert: boolean; state: string }[] = [];
    const sample = (at: number): void => {
      const p = h.snapshot().predators[index];
      seen.push({ at, alert: p.alert, state: p.state });
    };
    sample(0);
    const fixed = await h.until((s) => s.predators[index].state === "chase", {
      maxFrames: FIX_TICKS,
      poll: 1,
    });
    let spent = fixed.frames;
    sample(spent);
    for (let step = 0; step < WATCH_TICKS; step += WATCH_POLL) {
      await h.advance(WATCH_POLL);
      spent += WATCH_POLL;
      sample(spent);
    }
    await h.advance(CLIP_TICKS);
    return { fixed, seen, end: h.snapshot() };
  });

  requireSceneHeld(read.end, watch);

  assertEqual(
    read.fixed.hit,
    true,
    "the Lanternjaw takes a fix on a fully lit forager seven tiles away on a " +
      "clear line, which is the acquisition this point reads the absent alert " +
      "against",
  );

  // The acquisition happened, which is what makes the absence below a reading.
  assertEqual(
    read.seen.some((one) => one.state === "chase"),
    true,
    "the Lanternjaw is seen holding a fix inside the window that was watched",
  );
  const fired = read.seen.filter((one) => one.alert);
  assertTrue(
    fired.length === 0,
    `every reading of the Lanternjaw's alert across the acquisition and the ` +
      `${seconds(WATCH_TICKS).toFixed(2)} s after it is false — it read true at ` +
      `${fired.map((one) => `${seconds(one.at).toFixed(3)} s`).join(", ") || "no sample"}`,
  );
});
