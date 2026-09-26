// lamplighter/starts-at-origin-facing-right — a fresh run holds the lamplighter
// at the origin, facing right, at full health.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("The lamplighter"): "A run
// starts with the lamplighter at the origin, facing `"right"`, with `hp` equal
// to `maxHp`, which is `BASE_MAX_HP` while no Tallow is held", with "The plane"
// fixing the origin: "The origin `(0, 0)` is where the lamplighter stands when a
// run starts". specs/ui.md says the same of every route into a run: "a fresh
// run has the run clock at `0:00`, the lamplighter at the world origin `(0, 0)`
// with `hp = BASE_MAX_HP` (`100`) and `facing = "right"`". Each figure is
// exact: `0` and `0`, the string `"right"`, and `hp` equal to `maxHp`, which is
// `BASE_MAX_HP` (`100`) with no passive held.
//
// THE ROUTE. specs/instrumentation.md spells the fresh run out under
// `setScreen`: "a fresh run is `reset`, this pose to `playing`, and
// `setWeapon(0, \"taper\", 1)`", which is what `startRun` calls, reached without
// a menu. The run before it is
// disturbed on purpose, the lamplighter walked off the origin, turned left, and
// hurt, so that the fresh run's figures are the fresh run's and not what the
// harness's own reset happened to leave.
//
// THE PICTURE. One frame is stepped after the read, with every driver switch
// held so the frame poses nothing about the lamplighter, and the still is that
// frame's render of the run's first tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BASE_MAX_HP } from "../constants";
import {
  captureStill,
  createHarness,
  holdAll,
  player,
  startRun,
  type Harness,
} from "../harness";

/** Somewhere well off the origin, for the disturbed run. */
const DISTURBED_X = 300;
const DISTURBED_Y = -120;
const DISTURBED_HP = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens a fresh run with the lamplighter at (0, 0), facing right, at hp equal to maxHp", async () => {
  await startRun(h);
  await holdAll(h);
  await h.debug.setPlayerPosition(DISTURBED_X, DISTURBED_Y);
  await h.debug.setFacing("left");
  await h.debug.setHp(DISTURBED_HP);
  const disturbed = player(await h.snapshot());
  assertEqual(disturbed.x, DISTURBED_X, "player.x of the disturbed run");
  assertEqual(disturbed.facing, "left", "facing of the disturbed run");

  const fresh = await startRun(h);
  await holdAll(h);
  await h.step(1);
  await captureStill(h, "start");

  assertEqual(fresh.screen, "playing", "the screen a fresh run opens on");
  const at = player(fresh);
  assertEqual(at.x, 0, "player.x at the start of a run");
  assertEqual(at.y, 0, "player.y at the start of a run");
  assertEqual(at.facing, "right", "facing at the start of a run");
  assertEqual(
    at.hp,
    fresh.run.maxHp,
    "hp at the start of a run, against maxHp",
  );
  assertEqual(
    fresh.run.maxHp,
    BASE_MAX_HP,
    "maxHp at the start of a run, with no Tallow held",
  );
});
