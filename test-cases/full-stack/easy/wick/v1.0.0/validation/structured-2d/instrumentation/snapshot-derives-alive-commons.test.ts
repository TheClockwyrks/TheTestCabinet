// Wick — instrumentation/snapshot-derives-alive-commons: the snapshot derives
// `aliveCommons` from the enemies on the field.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`, the
// derived table under "Snapshot shape": `aliveCommons` is "how many of
// `enemies` have `rank` `common` in `ENEMIES` and are not `gnat`", which is 1
// for a moth beside two gnats and a mothwing (rank `elite`,
// specs/enemies.md).
//
// THE POSE. An isolated run, every switch off, the four enemies placed well
// apart from the lamplighter and each other so nothing overlaps. Read before
// any tick: the field derives from the state at the read.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads aliveCommons 1 for a moth beside two gnats and a mothwing", async () => {
  isolate(h);
  placeEnemy(h, "moth", 300, 0);
  placeEnemy(h, "gnat", -300, 0);
  placeEnemy(h, "gnat", 0, 300);
  placeEnemy(h, "mothwing", 0, -300);

  const { run } = h.snapshot();
  await h.frameDraw();
  captureStill(h, "commons");

  assertEqual(run.enemies.length, 4, "the enemies posed");
  assertEqual(
    run.aliveCommons,
    1,
    "run.aliveCommons with a moth, two gnats, and a mothwing",
  );
});
