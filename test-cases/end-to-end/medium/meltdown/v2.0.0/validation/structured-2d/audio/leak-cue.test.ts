// Meltdown — audio/leak-cue: a unit reaching its assigned exhaust plays the
// `leak` cue on the frame it reaches it.
//
// `specs/audio.md` binds `leak` to "a surge unit reaches its assigned exhaust"
// and fixes the frame: a cue "is raised by the frame that resolves the event it
// answers". `specs/mazing.md` fixes the event — a unit leaves the floor "when the
// tile its centre occupies is one of the opening tiles of its assigned
// exhaust" — and `specs/surge.md` prices it, so the frame the lives fall is the
// frame the leak resolved on.
//
// THE LEAK IS WALKED INTO. The Mote is entered at the left vent by the same
// `addUnit` the spawner uses, which assigns it the left vent's fixed opposite,
// the right exhaust (`specs/floor.md`), and it is then posed one orthogonal step
// short of that exhaust's opening. It reaches the exhaust under its own motion,
// on its own route, at its own speed: what is posed is where it started.
//
// NOTHING ELSE CAN SOUND HERE. The floor carries no tower, so no shot resolves,
// nothing dies and nothing trips; the run is in its build phase with the world
// gate shut, so no wave is released and none clears; and the run opens on twenty
// lives, so one Mote's single life does not end it (`specs/modes.md`,
// `specs/surge.md`). That is what makes "the leak cue and nothing else" a reading
// of the build rather than of the scenario.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import { CUES } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  ticksFor,
  watchCues,
  type Harness,
} from "../harness";
import { playedBefore, playedOn, poseLeaker } from "./cues";

/**
 * How long the Mote is given to walk the last tile into the exhaust.
 *
 * It is posed one orthogonal step out, which is `TILE` (`19`) logical units
 * (`specs/floor.md`, `specs/mazing.md`), and a Mote's base speed is `60` units
 * per second (`specs/surge.md`), so a conforming build carries it in in about
 * `0.32` seconds. Two seconds is a hard ceiling six times that: a build that is
 * merely slow fails here rather than leaving the point inconclusive.
 */
const LEAK_TICKS = ticksFor(2);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the leak cue on the frame the unit reaches its exhaust", async () => {
  startRun(h);
  const opened = h.snapshot();
  poseLeaker(h);

  // Subscribed after the floor is posed, so what is read is the walk alone.
  const played = watchCues(h);

  // A leak "costs its leak value in lives" (specs/surge.md), so the frame the
  // lives fall is the frame the unit reached its exhaust on.
  const leak = await h.until((s) => s.lives < opened.lives, {
    maxFrames: LEAK_TICKS,
  });
  const frame = h.engine.frame().count;
  captureStill(h, "leak");

  assertEqual(
    leak.hit,
    true,
    `the Mote walked into the right exhaust inside ${String(LEAK_TICKS)} ` +
      "frames (specs/mazing.md, How the surge crosses the floor)",
  );
  assertLength(
    playedBefore(played, frame),
    0,
    "cues that played on any frame before the leak — a cue is raised by the " +
      "frame that resolves the event it answers (specs/audio.md)",
  );
  assertDeepEqual(
    playedOn(played, frame),
    [CUES.leak],
    "the cues that played on the frame the unit reached its exhaust: the leak " +
      "cue, and nothing else (specs/audio.md)",
  );
  assertGreaterThan(
    played[0].gain,
    0,
    "the gain the leak cue played at on an unmuted bus (specs/audio.md)",
  );
});
