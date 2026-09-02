// lamplighter/starts-at-origin-facing-right — a run starts at the origin.
//
// WHAT THIS DECIDES. The lamplighter's opening state: a fresh run holds it at
// `(0, 0)`, facing `"right"`, with `hp` equal to `maxHp`.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The lamplighter"): "A run
// starts with the lamplighter at the origin, facing `"right"`, with `hp`
// equal to `maxHp`, which is `BASE_MAX_HP` while no Tallow is held." And
// ("The plane"): "The origin `(0, 0)` is where the lamplighter stands when a
// run starts". `hp` is compared with the `maxHp` the same snapshot reports
// rather than with `100`, because the rule is the equality; `maxHp`'s own
// figure is the derived-stats points' business.
//
// WHY THE WORLD IS POSED AS IT IS. `freshRun` is `reset` and
// `setScreen("playing")`, which specs/instrumentation.md makes "a fresh run
// exactly as `LIGHT THE LAMP` and `TRY AGAIN` do" — the real start of a run
// without the title menu, whose keys are the screens' points. The reading is
// taken at tick `0`, before any frame, since the opening state is what a tick
// then acts on. For the still, the driver switches are turned off and one
// frame is drawn: with no key held the lamplighter stands where it started,
// and nothing spawns into the picture.
//
// THE TOLERANCE. `MOTION_EPS` about the origin, which admits `-0` and nothing
// a tick could produce; `facing` and the `hp`/`maxHp` equality are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { MOTION_EPS } from "../constants";
import {
  captureStill,
  createHarness,
  freshRun,
  setSwitches,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds the lamplighter at (0, 0) facing right with hp at maxHp on a fresh run", async () => {
  const opening = freshRun(h);

  setSwitches(h, false);
  await h.advance(1);
  captureStill(h, "start");

  assertEqual(opening.screen, "playing", "the screen a fresh run opens on");
  const { player, maxHp } = opening.run;
  assertNear(player.x, 0, MOTION_EPS, "player.x at the start of a run");
  assertNear(player.y, 0, MOTION_EPS, "player.y at the start of a run");
  assertEqual(player.facing, "right", "facing at the start of a run");
  assertEqual(player.hp, maxHp, "hp at the start of a run, against maxHp");
});
