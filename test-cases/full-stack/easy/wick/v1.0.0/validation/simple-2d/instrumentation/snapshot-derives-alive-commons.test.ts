// instrumentation/snapshot-derives-alive-commons — with a moth, two gnats, and
// a mothwing alive the snapshot reads aliveCommons 1.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md, the "Derived from"
// table: `aliveCommons` is "how many of `enemies` have `rank` `common` in
// `ENEMIES` and are not `gnat`". specs/enemies.md gives the moth rank common,
// the gnat rank common, and the mothwing rank elite, so of the four alive
// exactly the moth counts.
//
// THE POSE. An isolated run with the four enemies through `spawnEnemy`, every
// switch off so none moves, hits, or despawns, and the reading taken with no
// tick between.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  spawnEnemyAt,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("counts the commons alive, leaving out gnats and elites", async () => {
  isolate(h);
  spawnEnemyAt(h, "moth", 300, 0);
  spawnEnemyAt(h, "gnat", -300, 0);
  spawnEnemyAt(h, "gnat", 0, 300);
  spawnEnemyAt(h, "mothwing", 0, -300);
  const { run } = h.snapshot();
  await h.tick(1);
  captureStill(h, "commons");

  assertEqual(run.enemies.length, 4, "the enemies alive");
  assertEqual(run.aliveCommons, 1, "aliveCommons: the moth alone");
});
