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
// THE CUE IS READ BY NAME. The game asks the runtime's cue bus for a cue by name
// and the bus announces the play (`specs/progression.md`), so what is asserted
// here is the exact name that file fixes, sounding exactly ONCE on the event's own
// tick — which is the "at most once on that tick" half of the requirement — and
// not at all on the ticks before it.
//
// WHAT THIS DOES NOT DECIDE. The cadence itself, which is
// `gloamfin/ping-cadence`'s; what a ping reveals, which is
// `gloamfin/ping-reveals-nothing`'s; its color, which is
// `gloamfin/lost-you-orange`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUES, GLOAMFIN_PING_INTERVAL } from "../constants";
import { poseApart, spawnPredator } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  ticks,
  type Harness,
} from "../harness";
import { parkForager, requireSceneHeld, sceneGuard } from "../scene";
import { cuesBeforeEvent, cuesOnEvent, watchForEvent } from "./cues";

/**
 * How far the hunter's sealed ring sits from the forager's room, in tiles.
 *
 * Ten tiles is `320` logical units, comfortably past `GLOAMFIN_HEAR` (`64`) and
 * past the `GLOAMFIN_PING_RANGE` (`9`) tiles a ping itself carries, so the two
 * halves of the board have nothing to say to each other.
 */
const APART_TILES = 10;

/**
 * The ceiling on the watch, in frames.
 *
 * `GLOAMFIN_PING_INTERVAL` is `4 s`, so a wandering Gloamfin casts inside that.
 * Twice the interval and a second over is a hard window: a build whose hunter
 * never pings fails on the bound rather than leaving the point inconclusive.
 */
const PING_TICKS = ticks(2 * GLOAMFIN_PING_INTERVAL + 1);

/** Frames run past the reading, purely so the clip shows the ping traveling. */
const TAIL_TICKS = ticks(1);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.predatorPing on the tick a Gloamfin casts its ping, and not before", async () => {
  await startPlaying(h);
  const rooms = await poseApart(h, APART_TILES);
  // The ping is cast by its mind on its own cadence, so its mind runs and its
  // travel is held: it casts from the tile the fixture put it on.
  await spawnPredator(h, "gloamfin", rooms.far, {
    state: "wander",
    travel: false,
  });
  await parkForager(h, rooms.near);
  const watch = await sceneGuard(h);

  const seen = await captureReplay(h, "pulse", async () => {
    const found = await watchForEvent(
      h,
      (s) => s.pulses.some((pulse) => pulse.source === "gloamfin"),
      PING_TICKS,
    );
    // Past the reading, so the clip shows the ping crossing its ring. Nothing
    // after this line can reach an assertion.
    await h.advance(TAIL_TICKS);
    return found;
  });

  requireSceneHeld(h.snapshot(), watch);

  assertEqual(
    seen.hit,
    true,
    `the wandering Gloamfin cast one of its own pings inside ${String(PING_TICKS)} ` +
      `ticks, which is twice its GLOAMFIN_PING_INTERVAL ` +
      `(${String(GLOAMFIN_PING_INTERVAL)} s) cadence`,
  );
  assertEqual(
    cuesBeforeEvent(seen, CUES.predatorPing),
    0,
    `times CUES.predatorPing played over the ${String(seen.at - 1)} ticks ` +
      "before the ping — a cue is played on the tick its event happens " +
      "(specs/progression.md)",
  );
  assertEqual(
    cuesOnEvent(seen, CUES.predatorPing),
    1,
    "times CUES.predatorPing played on the tick the Gloamfin's ping entered " +
      "flight, which is its own tick and at most once on it " +
      "(specs/progression.md)",
  );
});
