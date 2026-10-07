// machinery/grant-tailmost-mark — the mark nearest the tail decides what is left
// active when one extracted run carries two.
//
// THE SPEC LINE. `specs/machinery.md` — "Granting": "When one extracted run
// carries more than one marked core, each is granted in train order from the
// head, so the mark nearest the tail decides what is left active."
//
// WHY IT IS A POINT. It is a rule the general grant does not produce on its own:
// a build that grants a run's marks in any other order — tail first, or the first
// one it happens to find — reaches a different active machinery from exactly the
// same extraction. `machinery/grant-on-extraction` decides that a grant happens
// at all; this decides which of two survives.
//
// THE POSE. Two adjacent cores of the run's charge, the head carrying
// {@link HEAD_MARK} and the one behind it carrying {@link TAIL_MARK}. The shot
// seats square between them, as `machinery/insertion-stage` describes, so the
// maximal same-charge run is all three and both marked cores leave the channel on
// the same tick. Nothing else stands on the channel and nothing arrives.
//
// WHAT THE READING SEPARATES. `specs/machinery.md` — "The active machinery":
// "At most one of `choke`, `backflow` and `sightline` is active at a time", so
// one of the two marks is what the snapshot reports. The specification says it is
// the one nearer the TAIL, which after the insertion is `sightline`; a build that
// granted from the tail forward, or that kept the first grant it made, would
// report `choke`. The two kinds are distinguishable in the same reading, so one
// equality decides the rule in both directions.
//
// TOLERANCE. None: the reading is a machinery kind, which the case grades exactly.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { SPACING } from "../constants";
import {
  captureReplay,
  createHarness,
  type Harness,
  type PosedCore,
} from "../harness";
import {
  assertExtracted,
  driveExtraction,
  RUN_CHARGE,
  STRUCK_S,
  TRAILING_TICKS,
} from "./insertion-stage";

/** The mark on the head core: the one granted FIRST, and so overwritten. */
const HEAD_MARK = "choke";

/** The mark on the core behind it: the one nearest the tail, which decides. */
const TAIL_MARK = "sightline";

/** The two cores the shot completes into a run of three. */
const CORES: PosedCore[] = [
  [STRUCK_S, RUN_CHARGE, HEAD_MARK],
  [STRUCK_S - SPACING, RUN_CHARGE, TAIL_MARK],
];

/** The cores the extraction removes: the two posed plus the seated one. */
const REMOVED = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it(`leaves ${TAIL_MARK} active when a run carries ${HEAD_MARK} ahead of it`, async () => {
  const after = await captureReplay(h, "tailmost", async () => {
    const resolved = await driveExtraction(h, CORES);
    await h.step(TRAILING_TICKS);
    return resolved;
  });

  assertExtracted(after, CORES.length, REMOVED);
  assertNotNull(
    after.machinery,
    "the active machinery on the tick a run carrying two marks was extracted",
  );
  assertEqual(
    after.machinery?.kind,
    TAIL_MARK,
    `the kind left active by a run carrying ${HEAD_MARK} at its head and ` +
      `${TAIL_MARK} behind it, which the specs decide by the mark nearest the tail`,
  );
});
