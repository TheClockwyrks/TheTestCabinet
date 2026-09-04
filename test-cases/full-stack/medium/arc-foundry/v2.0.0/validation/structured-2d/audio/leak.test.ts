// Arc Foundry — audio/leak: the leak cue sounds on the frame a unit grounds out,
// and on no frame before it.
//
// THE REQUIREMENT, from the cue table of `specs/ui.md`: `CUES.leak` is played when
// "a unit grounds out at the collector", and each cue is played "on the frame its
// event happens, by the code that raised it, and at most once on that frame".
//
// THE SCENARIO. One Mote released short of the collector and heading for it, and
// one further Mote held at the map's entry so the live wave cannot clear underneath
// the reading. There is NO structure on the yard at all, which is what makes the
// run-up readable: with nothing firing, the specification names no event between
// the release and the leak, so every frame of the walk must be silent.
//
// WHAT MARKS THE EVENT. `specs/campaign.md` takes Grid Integrity when a unit
// grounds out, so the frame the integrity drops below its opening figure is the
// frame the leak resolved.
//
// THE CUE'S NAME IS READ, not merely that something sounded: the engine announces
// each play by name.

import { afterEach, beforeEach, it } from "vitest";
import {
  CUES,
  mapById,
  type Point,
  START_INTEGRITY,
  tileCenter,
} from "../constants";
import { assertContains, assertDeepEqual, assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  type Harness,
  holdWaveClear,
  openYard,
  releaseUnit,
  ticks,
  watchCues,
} from "../harness";
import { beforeFrame, names, onFrame } from "./cues";

const SINK = ((): Point => {
  const map = mapById("substation");
  return tileCenter(map.collector.col, map.collector.row);
})();

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sounds on the frame the unit grounds out, and not on the walk in", async () => {
  openYard(h, { map: "substation", wave: 1 });
  holdWaveClear(h);
  releaseUnit(h, "mote", {
    waypoint: 7,
    at: { x: SINK.x - 60, y: SINK.y },
  });

  const leak = await captureReplay(h, "leak", async () => {
    const cues = watchCues(h);
    const grounded = await h.until((s) => s.integrity < START_INTEGRITY, {
      maxFrames: ticks(6),
    });
    return { grounded: grounded.hit, frame: h.frame(), cues };
  });

  assertEqual(
    leak.grounded,
    true,
    "a Mote released sixty units short of the collector and heading for it to " +
      "ground out within six seconds (specs/pathing.md)",
  );
  assertDeepEqual(
    names(beforeFrame(leak.cues, leak.frame)),
    [],
    "no cue to sound while a unit walks the last stretch to the collector " +
      "with no structure on the yard (specs/ui.md)",
  );
  assertContains(
    names(onFrame(leak.cues, leak.frame)),
    CUES.leak,
    `the ${CUES.leak} cue on the frame a unit grounds out (specs/ui.md)`,
  );
});
