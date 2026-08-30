// Arc Foundry — audio/settle: the settle cue sounds when the unharvested
// candidates harden, and on no frame before it.
//
// THE REQUIREMENT, from the cue table of `specs/ui.md`: `CUES.settle` is played
// when "unharvested candidates harden into blockers at wave start", and each cue is
// played "on the update its event happens, and at most once on that update".
//
// THE SCENARIO IS THE LEVEL'S OWN HARVEST. `specs/scrap-press.md` grants five rock
// stamps a build phase and resolves a harvest in three steps: "The harvest resolves
// into one permanent structure. Every remaining candidate hardens into a blocker
// for the rest of the run. The wave begins." So five rocks are dropped and one is
// kept, and the four that were not kept harden on that commit — which is the event
// this cue is bound to.
//
// WHY THIS ONE IS COUNTED ACROSS THE CALL. Keeping is a CONTROL's event, resolved
// at the commit rather than inside a frame, and a build may sound the cue there or
// on the update that follows. So what is counted is every sound across the keep and
// the frame after it. The five drops each raise their own event and are done with
// well before the run-up, which is held silent so a build that blips every frame
// fails there rather than passing on the harvest.
//
// WHAT CANNOT BE SEPARATED. A build that plays the WRONG cue on the right event;
// the name of a sound is not observable from outside an engineless build.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { STAMPS_PER_LEVEL } from "../constants";
import {
  captureReplay,
  createHarness,
  openYard,
  standCandidate,
  type Harness,
} from "../harness";
import { RUN_UP, SETTLE, sounds } from "./cues";

/** Five clear anchors, well away from the map's waypoint platforms and its chain. */
const ANCHORS = [12, 16, 20, 24, 28].map((col) => ({ col, row: 24 }));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds when the unharvested candidates harden, and not before", async () => {
  await h.armAudio();
  await openYard(h, { wave: 1 });
  await h.advance(SETTLE);

  const candidates: number[] = [];
  for (const anchor of ANCHORS) {
    candidates.push(
      await standCandidate(h, "capacitor", 1, anchor.col, anchor.row),
    );
  }
  assertEqual(
    candidates.length,
    STAMPS_PER_LEVEL,
    "the level's five stamps to place five candidates (specs/scrap-press.md)",
  );

  await h.advance(1);
  const opening = await sounds(h);
  await h.advance(RUN_UP);
  const settled = await sounds(h);

  const harvest = await captureReplay(h, "settle", async () => {
    await h.debug.keep(candidates[0]!);
    await h.advance(1);
    return { heard: (await sounds(h)) - settled, yard: await h.snapshot() };
  });

  assertEqual(
    settled - opening,
    0,
    "nothing to sound over the frames between the last drop and the harvest, " +
      "where the specification names no event (specs/ui.md)",
  );
  assertEqual(
    harvest.yard.structures.filter((s) => s.kind === "blocker").length,
    STAMPS_PER_LEVEL - 1,
    "the four candidates that were not harvested to harden into blockers " +
      "(specs/scrap-press.md)",
  );
  assertGreaterThan(
    harvest.heard,
    0,
    "a cue to sound when the unharvested candidates harden (specs/ui.md)",
  );
});
