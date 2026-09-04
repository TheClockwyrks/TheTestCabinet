// audio/pred-pulse — the predator-ping cue.
//
// `specs/progression.md` fixes `CUES.predatorPing` (`"predator-ping"`) as the cue
// played when "a Gloamfin emits one of its own sonar pings", and governs all
// seven with one sentence: "Each is played on the tick its event happens, and at
// most once on that tick."
//
// THE PING IS EARNED, NOT POSED. `specs/predators/gloamfin.md` has a wandering
// Gloamfin cast its own ping on its own cadence, and `specs/instrumentation.md`
// gives the surface no operation that casts one. So the hunter is set wandering
// and the check waits it out.
//
// AND IT IS WAITED OUT SOMEWHERE IT CANNOT REACH THE FORAGER. `poseApart` lays
// down two sealed rooms — the forager's, and a ring across solid rock for the
// hunter to patrol — because on a connected board "far away" is only a head
// start: a patrol crosses the grid in a few seconds, and a Gloamfin that arrives
// and takes a fix stops casting the periodic ping this point is about. A posed
// fixture is exempt from `specs/maze.md`'s connectedness rule
// (`specs/instrumentation.md`), so the two halves stay apart for the whole watch.
//
// THE EVENT IS THE PING ENTERING FLIGHT, which `specs/state.md` reports as a
// `pulses` entry whose `source` is `"gloamfin"`.
//
// WHAT THIS ENGINE CANNOT SEE. The cue's NAME, and how many sources one cue is
// made of. `validation/audio/cues.ts` states why, and what these checks assert
// instead.
//
// WHAT THIS DOES NOT DECIDE. The cadence itself, which is
// `gloamfin/ping-cadence`'s; what a ping reveals, which is
// `gloamfin/ping-reveals-nothing`'s; its color, which is
// `gloamfin/lost-you-orange`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { GLOAMFIN_PING_INTERVAL, ticksFor } from "../constants";
import { poseApart, spawnPredator } from "../fixtures";
import {
  captureReplay,
  createHarness,
  type Harness,
  startPlaying,
} from "../harness";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";
import {
  LEAD_POLL,
  soundsBeforeEvent,
  soundsOnEvent,
  watchForEvent,
} from "./cues";

/**
 * How far the hunter's sealed ring sits from the forager's room, in tiles.
 *
 * Ten tiles is `320` logical units, comfortably past `GLOAMFIN_HEAR` (`64`) and
 * past the `GLOAMFIN_PING_RANGE` (`9`) tiles a ping itself carries, so the two
 * halves of the board have nothing to say to each other.
 */
const APART_TILES = 10;

/**
 * The ceiling on the watch, in ticks.
 *
 * `GLOAMFIN_PING_INTERVAL` is `4 s`, so a wandering Gloamfin casts inside that.
 * Twice the interval and a second over is a hard window: a build whose hunter
 * never pings fails on the bound rather than leaving the point inconclusive.
 */
const PING_TICKS = ticksFor(2 * GLOAMFIN_PING_INTERVAL + 1);

/** Ticks run past the reading, purely so the clip shows the ping traveling. */
const TAIL_TICKS = ticksFor(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds on the tick a Gloamfin casts its own ping, and not before", async () => {
  // A real, browser-trusted gesture first: an engineless build owns its own audio
  // layer and is entitled to open it on the player's first interaction alone
  // (`specs/progression.md`). The key is bound to nothing, so this changes no state.
  await h.armAudio();
  await startPlaying(h);
  const rooms = await poseApart(h, APART_TILES);
  // The ping is cast by its mind on its own cadence, so its mind runs and its
  // travel is held: it casts from the tile the fixture put it on.
  await spawnPredator(h, "gloamfin", rooms.far, {
    state: "wander",
    travel: false,
  });
  await parkForager(h, rooms.near);
  const guard = await sceneGuard(h);

  const watch = await captureReplay(h, "pulse", async () => {
    const seen = await watchForEvent(
      h,
      (s) => s.pulses.some((pulse) => pulse.source === "gloamfin"),
      PING_TICKS,
      // The ping is its mind's own timer running down and nothing in
      // `specs/state.md` reports how far along it is, so there is no state to
      // hand the fine watch over at — the whole wait runs at the lead's grain.
      // `validation/audio/cues.ts` states what that reads and what it does not:
      // a step that sounded before the ping is still a violation and a ping that
      // arrived in silence is still a violation, and what is given up is telling
      // a cue on the ping's own tick from one a fifteenth of a second beside it.
      { lead: { poll: LEAD_POLL } },
    );
    // Past the reading, so the clip shows the ping crossing its ring. Nothing
    // after this line can reach an assertion.
    await h.advance(TAIL_TICKS);
    return seen;
  });

  requireSceneHeld(await h.snapshot(), guard);

  assertEqual(
    watch.hit,
    true,
    `the wandering Gloamfin cast one of its own pings inside ${String(PING_TICKS)} ` +
      `ticks, which is twice its GLOAMFIN_PING_INTERVAL (${String(GLOAMFIN_PING_INTERVAL)} s) cadence`,
  );
  assertEqual(
    soundsBeforeEvent(watch),
    0,
    `sounds the build emitted over every step before the one the ping entered ` +
      `flight on, which is the first ${String(watch.at - 1)} ticks of the watch, ` +
      "on a board where nothing else is happening — a cue is played on the tick " +
      "its event happens (specs/progression.md)",
  );
  assertGreaterThanOrEqual(
    soundsOnEvent(watch),
    1,
    "sounds the build emitted on the tick the Gloamfin's ping entered flight, " +
      "which is the tick CUES.predatorPing is played on (specs/progression.md)",
  );
});
