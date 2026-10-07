// instrumentation/surface-version — the surface names its own version, and the
// snapshot reports the same figure.
//
// THE RULE. "The surface carries `version` (`ORRERY_DEBUG_VERSION`, `1`), a plain
// number, and the operations below" (`specs/instrumentation.md`, The operations),
// and the shape the reading answers opens with `version: 1` (Snapshot shape),
// under a rule that covers every field of it: "Every field is read straight off
// the game's state, so what the snapshot reports is what the game holds."
//
// A PLAIN NUMBER, NOT A CALL. `version` is the one member of the surface that is
// read rather than invoked, so it is reached by reflection — `probe` reports the
// value and never calls it — and a build that exposed it as a function answers
// `"function"` here rather than a number.
//
// THE VERDICT. Both readings are `ORRERY_DEBUG_VERSION`, and they are the same
// figure: a surface that answered `1` and a snapshot that answered something else
// would leave a driver unable to tell which of the two it had.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ORRERY_DEBUG_VERSION } from "../constants";
import {
  captureStill,
  createHarness,
  openTitle,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports ORRERY_DEBUG_VERSION on the surface and in the snapshot", async () => {
  await openTitle(h);
  await captureStill(h, "version");

  const probed = await h.probe([]);
  assertEqual(
    typeof probed.version,
    "number",
    "the surface carries version as a plain number, not as a call",
  );
  assertEqual(
    probed.version,
    ORRERY_DEBUG_VERSION,
    "which specs/instrumentation.md fixes at ORRERY_DEBUG_VERSION (1)",
  );

  const snapshot = await h.snapshot();
  assertEqual(
    snapshot.version,
    ORRERY_DEBUG_VERSION,
    "the snapshot's version field reports the same figure",
  );
  assertEqual(
    snapshot.version,
    probed.version,
    "so the two readings of the surface's version agree",
  );
});
