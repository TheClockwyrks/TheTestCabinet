// Wick — instrumentation/set-player-position-leaves-the-rest: after
// `setPlayerPosition`, every enemy, projectile, zone, gem, and pickup holds
// the position it had, and `facing` and `hp` are untouched.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/instrumentation.md`,
// `setPlayerPosition(x, y)`: "Nothing else moves". The run after the call is
// the run before it with `player.x` and `player.y` replaced.
//
// THE SCENE. An isolated run with one of everything on the field, the
// lamplighter facing left with 40 hp; the whole `run` before compared with
// the whole `run` after, structurally.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  placeGem,
  placePickup,
  placeProjectile,
  placePuddle,
  type Harness,
} from "../harness";

const POSED_X = 300;
const POSED_Y = -120;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("moves the lamplighter's center and nothing else", async () => {
  isolate(h);
  h.debug.setFacing("left");
  h.debug.setHp(40);
  placeEnemy(h, "moth", 300, 0);
  placeProjectile(h, "ember", 100, 0, 400, 0, 0);
  placePuddle(h, "oil-splash", 50, 50);
  placeGem(h, "large", 400, 100);
  placePickup(h, "bread", -300, 0);
  const before = h.snapshot();

  h.debug.setPlayerPosition(POSED_X, POSED_Y);
  const after = h.snapshot();
  await h.frameDraw();
  captureStill(h, "held");

  assertDeepEqual(
    after.run,
    { ...before.run, player: { ...before.run.player, x: POSED_X, y: POSED_Y } },
    "run after setPlayerPosition, against the run before",
  );
});
