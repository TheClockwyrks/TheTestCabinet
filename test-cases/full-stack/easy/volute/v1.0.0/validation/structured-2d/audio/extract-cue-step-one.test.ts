// audio/extract-cue-step-one — an extraction at chain step 1 plays
// `extract-1`.
//
// THE SPEC LINE. `specs/ui.md` ("Audio"): "`extract-1` | An extraction
// resolves at chain step `1`". `specs/assets.md` says what the five are for:
// "one sound at five rising steps, each step recognizably the same sound
// higher, so a chain is heard climbing".
//
// WHY IT IS ITS OWN POINT. It is the first rung of the mapping, and the one a
// build with a single extraction cue passes. `audio/extract-cue-step-two` is
// what tells that build apart from one whose chain is heard climbing.
//
// WHY AN INSERTION AND NOT A MERGE. `specs/extraction.md` ("The chain step")
// gives step `1` to an "Extraction on an insertion" outright — "An
// insertion-caused extraction therefore scores at step 1" — whatever the chain
// stood at before it, while a merge takes "the previous step plus 1" and can
// never resolve at 1. So step 1 is reached the only way the specification
// reaches it.
//
// WHAT ELSE SOUNDS ON THAT TICK. The insertion resolves the seat and the
// extraction together, so `seat` sounds beside `extract-1` — which
// `specs/ui.md` allows: "a tick raising several different cues sounds each of
// them once". The other four extraction cues are asserted absent, which is the
// reading that makes this about the step rather than about extractions in
// general.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { MIN_RUN, OPENING_AIM } from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  driveShot,
  fireAt,
  poseHall,
  spacedRun,
  watchCues,
  type Harness,
} from "../harness";
import {
  EXTRACT_CUES,
  assertHeardOnce,
  assertSilentOn,
  openHall,
} from "./cues";

/** The head of the posed pair, at `(420, 40)` on specs/channel.md's first leg. */
const POSED_HEAD_S = 380;

/** The pair a seated halide completes into a run of three, and its stopper. */
const POSED = ["halide", "halide", "cobalt"] as const;

/** The charge fired into them. */
const FIRED = "halide";

/** Ticks recorded after the extraction, so the clip shows the recoil. */
const TRAIL_TICKS = 36;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds extract-1 on an extraction that resolves at chain step 1", async () => {
  await openHall(h);
  await poseHall(h, {
    cores: spacedRun(POSED_HEAD_S, POSED),
    loaded: FIRED,
  });
  await fireAt(h, OPENING_AIM);

  const played = watchCues(h);
  const drawn = await captureReplay(h, "extract", async () => {
    const landed = await driveShot(h);
    const measured = { landed, tick: h.tick(), cues: [...played] };
    await h.step(TRAIL_TICKS);
    return measured;
  });

  assertTrue(drawn.landed.landed, "the fired core resolved within the sweep");
  assertEqual(
    coreCount(drawn.landed.snapshot),
    POSED.length + 1 - MIN_RUN,
    "the cores left once the run of three was drawn out",
  );
  assertHeardOnce(
    drawn.cues,
    drawn.tick,
    "extract-1",
    "the extract-1 cue on the tick the run was drawn out",
  );
  assertSilentOn(
    drawn.cues,
    drawn.tick,
    EXTRACT_CUES.filter((name) => name !== "extract-1"),
    "the other four extraction cues on that tick",
  );
});
