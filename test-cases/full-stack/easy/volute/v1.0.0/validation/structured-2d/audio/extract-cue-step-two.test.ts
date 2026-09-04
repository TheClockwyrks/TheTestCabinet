// audio/extract-cue-step-two — an extraction at chain step 2 plays
// `extract-2`.
//
// THE SPEC LINE. `specs/ui.md` ("Audio"): "`extract-2` | An extraction
// resolves at chain step `2`". `specs/assets.md` says what the five are for:
// "one sound at five rising steps, each step recognizably the same sound
// higher, so a chain is heard climbing".
//
// WHY IT IS ITS OWN POINT. A build that sounds one extraction cue whatever the
// step passes `audio/extract-cue-step-one` and fails here, which is the whole
// of what "so a chain is heard climbing" asks for.
//
// HOW THE STEP IS REACHED. `specs/extraction.md` ("The chain step") gives an
// "Extraction on a merge" "the previous step plus 1", so a chain posed at 1
// before the merge resolves it at 2. `audio/merge.ts` carries the merge
// itself, on a tick no other cue of the table can reach.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  captureReplay,
  coreCount,
  createHarness,
  watchCues,
  type Harness,
} from "../harness";
import {
  EXTRACT_CUES,
  assertHeardOnce,
  assertSilentOn,
  openHall,
} from "./cues";
import { CORES_AFTER, driveMerge, poseMerge } from "./merge";

/** The chain step the hall is posed at; the merge resolves one above it. */
const POSED_STEP = 1;

/** Ticks recorded after the extraction, so the clip shows the recoil. */
const TRAIL_TICKS = 36;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds extract-2 on an extraction that resolves at chain step 2", async () => {
  await openHall(h);
  await poseMerge(h, POSED_STEP);

  const played = watchCues(h);
  const merged = await captureReplay(h, "extract", async () => {
    const drawn = await driveMerge(h);
    const measured = { drawn, tick: h.tick(), cues: [...played] };
    await h.step(TRAIL_TICKS);
    return measured;
  });

  assertTrue(merged.drawn.hit, "the run spanning the join to be extracted");
  assertEqual(
    coreCount(merged.drawn.snapshot),
    CORES_AFTER,
    "the cores left once the run spanning the join was drawn out",
  );
  assertHeardOnce(
    merged.cues,
    merged.tick,
    "extract-2",
    "the extract-2 cue on the tick the run was drawn out",
  );
  assertSilentOn(
    merged.cues,
    merged.tick,
    EXTRACT_CUES.filter((name) => name !== "extract-2"),
    "the other four extraction cues on that tick",
  );
});
