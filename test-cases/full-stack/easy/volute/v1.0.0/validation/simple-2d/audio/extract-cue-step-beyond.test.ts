// audio/extract-cue-step-beyond — an extraction past chain step 5 plays
// `extract-5`.
//
// THE SPEC LINE. `specs/ui.md` ("Audio"): "`extract-5` | An extraction
// resolves at chain step `5` or beyond". `specs/assets.md` says what the five
// are for: "one sound at five rising steps, each step recognizably the same
// sound higher, so a chain is heard climbing".
//
// WHY IT IS ITS OWN POINT. It is the edge the table's own "or beyond" states:
// the chain step has no ceiling, and a build that indexes a table of five by
// the step runs off the end of it on the sixth.
//
// HOW THE STEP IS REACHED. `specs/extraction.md` ("The chain step") gives an
// "Extraction on a merge" "the previous step plus 1", so a chain posed at 5
// before the merge resolves it at 6. `audio/merge.ts` carries the merge
// itself, on a tick no other cue of the table can reach.
//
// THE EDGE IT SITS ON. `specs/instrumentation.md`'s `setChainStep` bounds `k`
// only "of at least `1`", and `specs/extraction.md` puts no ceiling on the chain
// either — "a third extraction reached by a further merge scores at step 3",
// and so on — so a sixth step is a step the specification permits and a
// chaining player reaches.

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
const POSED_STEP = 5;

/** Ticks recorded after the extraction, so the clip shows the recoil. */
const TRAIL_TICKS = 36;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds extract-5 on an extraction that resolves at chain step 6", async () => {
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
    "extract-5",
    "the extract-5 cue on the tick the run was drawn out",
  );
  assertSilentOn(
    merged.cues,
    merged.tick,
    EXTRACT_CUES.filter((name) => name !== "extract-5"),
    "the other four extraction cues on that tick",
  );
});
