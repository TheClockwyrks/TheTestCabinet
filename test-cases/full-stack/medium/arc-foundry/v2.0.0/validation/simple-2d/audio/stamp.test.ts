// Arc Foundry — audio/stamp: the stamp cue sounds when a rock lands, and on no
// frame before it.
//
// THE REQUIREMENT, from the cue table of `specs/ui.md`: `CUES.stamp` is played when
// "a rock lands and rolls", and each cue is played "on the frame its event happens,
// by the code that raised it, and at most once on that frame".
//
// WHICH FRAME THAT IS, ON THIS ENGINE. A rock landing is a CONTROL's event:
// `specs/scrap-press.md` has the roll happen "the instant it lands", and
// `specs/instrumentation.md` has `placeRock` drop the rock through the real
// placement path. A debug operation under an engine is a pure state transition and
// cannot reach the cue bus — the engine hands the bus to `update` and nowhere else
// — so the cue the drop raises sounds on the ONE frame that follows it, which is
// the frame its event happens for a build on this engine. That is the frame read.
//
// THE RUN-UP IS HELD SILENT. The yard is emptied and a tenth of a second of it is
// driven before the drop, where the specification names no event at all, so a
// build that blips every frame fails there rather than passing on the drop.
//
// THE CUE'S NAME IS READ, not merely that something sounded: the engine announces
// each play by name.

import { afterEach, beforeEach, it } from "vitest";
import { CUES } from "../constants";
import { assertContains, assertDeepEqual, assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  openYard,
  watchCues,
  type Harness,
} from "../harness";
import { RUN_UP, beforeFrame, names, onFrame } from "./cues";

/** Clear ground, well away from the map's waypoint platforms and its chain. */
const ANCHOR = { col: 24, row: 18 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sounds on the frame after the rock lands, and not over the frames before it", async () => {
  openYard(h, { wave: 1 });
  await h.advance(1);

  const cues = watchCues(h);
  await h.advance(RUN_UP);

  const drop = await captureReplay(h, "stamp", async () => {
    h.debug.placeRock(ANCHOR.col, ANCHOR.row);
    await h.advance(1);
    return { frame: h.frame(), yard: h.snapshot() };
  });

  assertEqual(
    drop.yard.structures.length,
    1,
    "placeRock to land one candidate on the yard (specs/instrumentation.md)",
  );
  assertDeepEqual(
    names(beforeFrame(cues, drop.frame)),
    [],
    "no cue to sound over the frames before the rock is dropped, where the " +
      "specification names no event (specs/ui.md)",
  );
  assertContains(
    names(onFrame(cues, drop.frame)),
    CUES.stamp,
    `the ${CUES.stamp} cue on the frame a rock lands and rolls (specs/ui.md)`,
  );
});
