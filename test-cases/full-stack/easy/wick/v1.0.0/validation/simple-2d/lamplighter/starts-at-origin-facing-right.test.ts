// lamplighter/starts-at-origin-facing-right — a run starts at the origin
// facing right.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The lamplighter"): "A run
// starts with the lamplighter at the origin, facing "right", with hp equal to
// maxHp, which is BASE_MAX_HP while no Tallow is held." specs/state.md ("The
// idle run") fixes the same three values, `{ x: 0, y: 0, facing: "right",
// hp: BASE_MAX_HP }`, and "A fresh run is the idle run with Taper at level 1
// and cooldown 0 in the first weapon slot".
//
// HOW THE RUN IS STARTED. Through the surface alone, by the sequence
// specs/instrumentation.md names: "a fresh run is `reset`, this pose to
// `playing`, and `setWeapon(0, "taper", 1)`", which `freshRun` composes. No
// menu key stands between this point and the run it reads, so a build with a
// broken title menu and a correct run start fails the menu points and passes
// here.
//
// WHAT IS READ. The snapshot the moment the run begins, before any tick: the
// lamplighter's center, its facing, and its hp against the `maxHp` the same
// snapshot reports. hp is compared to `maxHp` rather than to 100 because the
// rule is "equal to maxHp"; what `maxHp` is with nothing held belongs to the
// stats points. One tick is then run so the frame that draws the fresh run is
// the still.
//
// TOLERANCE. FIGURE_TOLERANCE (1e-9) on the three numbers, the case's reading
// of a figure the spec states exactly: 0 and maxHp are set, not integrated,
// and a signed zero still reads as 0 under it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertWithin } from "../assert";
import { FIGURE_TOLERANCE } from "../constants";
import {
  captureStill,
  createHarness,
  freshRun,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the lamplighter at (0, 0), facing right, at full hp when a run starts", async () => {
  const fresh = freshRun(h);
  assertEqual(fresh.screen, "playing", "the screen a fresh run opens on");
  const { player, maxHp } = fresh.run;

  await h.tick(1);
  captureStill(h, "start");

  assertWithin(player.x, 0, FIGURE_TOLERANCE, "player.x as a run starts");
  assertWithin(player.y, 0, FIGURE_TOLERANCE, "player.y as a run starts");
  assertEqual(player.facing, "right", "facing as a run starts");
  assertWithin(
    player.hp,
    maxHp,
    FIGURE_TOLERANCE,
    "hp as a run starts, against the maxHp the snapshot reports",
  );
});
