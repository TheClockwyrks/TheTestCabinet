// Wick — instrumentation/snapshot-derives-alive-commons: with a moth, two
// gnats, and a mothwing alive the snapshot reads `aliveCommons` 1.
//
// WHERE THE THRESHOLD COMES FROM (specs/instrumentation.md — "Snapshot shape",
// the derived-fields table): "`aliveCommons` | how many of `enemies` have
// `rank` `common` in `ENEMIES` and are not `gnat`". Of the four alive only the
// moth is a common that is not a gnat.
//
// WHY THE WORLD IS POSED AS IT IS. The two gnats and the mothwing are the two
// exclusions the count names, posed beside the one enemy it counts, so a build
// counting every enemy reads 4, one counting every common reads 3, and one
// leaving out only the elite reads 3. The night is isolated and every faculty
// held so nothing else spawns or dies before the read.

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

afterEach(async () => {
  await h.dispose();
});

it("counts the commons alive, leaving out gnats and elites", async () => {
  await isolate(h);
  await placeEnemy(h, "moth", 200, 0);
  await placeEnemy(h, "gnat", -200, 0);
  await placeEnemy(h, "gnat", 0, 200);
  await placeEnemy(h, "mothwing", 0, -300);
  const s = await h.snapshot();
  await captureStill(h, "commons");

  assertEqual(s.run.enemies.length, 4, "the enemies alive");
  assertEqual(
    s.run.aliveCommons,
    1,
    "aliveCommons: the moth alone, gnats and the elite left out",
  );
});
