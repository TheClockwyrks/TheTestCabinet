// channel/seeded-twelve — a level opens with exactly twelve cores standing on
// the channel.
//
// THE SPEC LINE. `specs/channel.md`, "The seeded cores": "A level starts with
// `12` cores already on the channel". `specs/instrumentation.md`, `startLevel`:
// "Opens `level` ... exactly as the interlude before it opens it: the screen
// becomes `playing`, the channel holds the cores a level opens with". So opening
// a level through the surface is the level opening, and the count the snapshot
// reports at that instant is the count the specification fixes.
//
// THE TOLERANCE. None: a count is exact ("count, score, charge id, screen |
// exact"). Twelve cores is twelve cores, and a build that seeds eleven or
// thirteen is wrong by a whole core.
//
// THE READING IS TAKEN BEFORE ANY TICK RUNS. The inlet emits on a tick where the
// tail is at least `SPACING` out, and the seeded tail sits at `s = 0`, so no
// emission can land inside the reading — but the count that the *opening* fixes
// is the one before the hall has run at all, so nothing is stepped before it is
// read. The still is taken from the frame the build's own loop is drawing, which
// `specs/instrumentation.md` requires it to keep drawing off the clock
// ("Drawing is unaffected either way: the loop keeps rendering"), so the
// evidence costs the reading nothing.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SEED_COUNT } from "../constants";
import {
  captureStill,
  coreCount,
  createHarness,
  type Harness,
} from "../harness";

/** Long enough for the build's own render loop to have drawn the opened level. */
const RENDER_MS = 120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens a level with twelve cores on the channel", async () => {
  await h.debug.startLevel(1);
  const opened = await h.snapshot();

  await h.page.waitForTimeout(RENDER_MS);
  await captureStill(h, "opening");

  assertEqual(
    coreCount(opened),
    SEED_COUNT,
    "the cores standing on the channel as a level opens",
  );
});
