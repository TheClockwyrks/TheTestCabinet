// Arc Foundry — audio/settle: the settle cue sounds when the unharvested
// candidates harden, and on no frame before it.
//
// THE REQUIREMENT, from the cue table of `specs/ui.md`: `CUES.settle` is played
// when "unharvested candidates harden into blockers at wave start", and each cue is
// played "on the frame its event happens, by the code that raised it, and at most
// once on that frame".
//
// THE SCENARIO IS THE LEVEL'S OWN HARVEST. `specs/scrap-press.md` grants five rock
// stamps a build phase and resolves a harvest in three steps: "The harvest resolves
// into one permanent structure. Every remaining candidate hardens into a blocker
// for the rest of the run. The wave begins." So five rocks are dropped and one is
// kept, and the four that were not kept harden on that commit — which is the event
// this cue is bound to.
//
// WHICH FRAME THAT IS, ON THIS ENGINE. Keeping is a CONTROL's event, and a debug
// operation under an engine is a pure state transition that cannot reach the cue
// bus, so the cue the commit raises sounds on the ONE frame that follows it. The
// five drops raise their own cue and are done with on the frame before the run-up,
// which is held silent so a build that blips every frame fails there rather than
// passing on the harvest.
//
// THE CUE'S NAME IS READ, not merely that something sounded.

import { afterEach, beforeEach, it } from "vitest";
import { CUES, STAMPS_PER_LEVEL } from "../constants";
import { assertContains, assertDeepEqual, assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  openYard,
  standCandidate,
  watchCues,
  type Harness,
} from "../harness";
import { RUN_UP, beforeFrame, names, onFrame } from "./cues";

/** Five clear anchors, well away from the map's waypoint platforms and its chain. */
const ANCHORS = [12, 16, 20, 24, 28].map((col) => ({ col, row: 24 }));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sounds on the frame after the unharvested candidates harden, and not before", async () => {
  openYard(h, { wave: 1 });

  const candidates: number[] = [];
  for (const anchor of ANCHORS) {
    candidates.push(standCandidate(h, "capacitor", 1, anchor.col, anchor.row));
  }
  assertEqual(
    candidates.length,
    STAMPS_PER_LEVEL,
    "the level's five stamps to place five candidates (specs/scrap-press.md)",
  );

  // The frame that carries the drops' own cue, before the silent run-up.
  await h.advance(1);
  const cues = watchCues(h);
  await h.advance(RUN_UP);

  const harvest = await captureReplay(h, "settle", async () => {
    h.debug.keep(candidates[0]!);
    await h.advance(1);
    return { frame: h.frame(), yard: h.snapshot() };
  });

  assertEqual(
    harvest.yard.structures.filter((s) => s.kind === "blocker").length,
    STAMPS_PER_LEVEL - 1,
    "the four candidates that were not harvested to harden into blockers " +
      "(specs/scrap-press.md)",
  );
  assertDeepEqual(
    names(beforeFrame(cues, harvest.frame)),
    [],
    "no cue to sound over the frames between the last drop and the harvest, " +
      "where the specification names no event (specs/ui.md)",
  );
  assertContains(
    names(onFrame(cues, harvest.frame)),
    CUES.settle,
    `the ${CUES.settle} cue on the frame the unharvested candidates harden ` +
      "(specs/ui.md)",
  );
});
