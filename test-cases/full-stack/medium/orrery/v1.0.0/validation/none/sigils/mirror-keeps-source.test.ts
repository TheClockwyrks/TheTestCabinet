// sigils/mirror-keeps-source — a `mirror` COPIES its source essence rather than
// spending it: the source is still resting on its hex, unchanged, afterwards.
//
// THE RULE. "When the source holds an essence and the target holds `dust`, the
// target becomes that essence" (`specs/sigils.md`, Transmuting sigils). The
// sentence gives the effect in full, and it is a change to the TARGET alone. The
// sigils that spend what they read say so — `ascend`'s "the `mercury` is
// consumed", `conjoin`'s "both are consumed" — and `mirror` says nothing of the
// kind, so its source survives the boundary exactly as it stood.
//
// THE CONFIGURATION. One `mirror` anchored at `(0, 0)` at rotation `0`, so its
// source is `(0, 0)` and its target is `(1, 0)`. A `nova` on the source and a
// `dust` on the target, and nothing else on the field.
//
// THE VERDICT, in two halves that need each other. The target is `nova`, so the
// copy really happened and this is not a boundary that did nothing; and the
// source mote, by the id it was spawned with, is still `nova`, still resting on
// `(0, 0)`, with the field carrying exactly the two motes it started with.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNotNull } from "../assert";
import { neighbor } from "../field";
import { sigilPart, solution } from "../formats";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureStill,
  createHarness,
  looseMotes,
  moteAt,
  moteById,
  openBareRun,
  spawnMote,
  type Harness,
} from "../harness";

let h: Harness;

/** The mirror's source hex, and the target east of it at rotation 0. */
const SOURCE = ORIGIN;
const TARGET = neighbor(ORIGIN, 0);

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the source essence resting on its hex after the copy", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([sigilPart("mirror", SOURCE.q, SOURCE.r, 0)]),
  });

  const source = await spawnMote(h, SOURCE, "nova");
  await spawnMote(h, TARGET, "dust");

  await advanceCycles(h, 1);
  await captureStill(h, "source-kept");

  const after = await h.snapshot();
  assertEqual(
    after.sim?.status,
    "running",
    "nothing on the field moves, so the cycle reaches its boundary",
  );
  assertEqual(
    moteAt(after, TARGET)?.type,
    "nova",
    "the target took the source's essence, so the copy really happened",
  );

  const kept = moteById(after, source);
  assertNotNull(kept, "the source mote is still on the field: it is not spent");
  assertEqual(
    kept?.type,
    "nova",
    "and it still carries the essence it was copied from",
  );
  assertEqual(
    `${kept?.q},${kept?.r}`,
    `${SOURCE.q},${SOURCE.r}`,
    "still resting on the source hex",
  );
  assertLength(
    looseMotes(after),
    2,
    "and the field carries the two motes it started with: a copy adds none and takes none away",
  );
});
