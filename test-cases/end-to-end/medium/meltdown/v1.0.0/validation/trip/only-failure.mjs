// Automated validation for the Trip sub-item `only-failure`.
//
// A tower is never destroyed or damaged by the surge — overheating is the only way
// it fails (specs/heat.md). We place a tower beside the lane, drive a stream of real
// units past it (they leak), and confirm the tower is still there, unchanged, after
// the surge has passed.

import { newGame, build, spawn, tower, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("trip.only-failure");

  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const id = await build(api, "arc", 10, 22);
  check.expectOk("the tower placed", id !== null);

  // A stream of real units walks the floor and leaks past the tower.
  for (let i = 0; i < 6; i += 1) await spawn(api, "mote", "left");
  await stepUntil(api, (s) => s.surge.length === 0, 30, 0.1);

  const t = await tower(api, id);
  check.expectOk("the tower is still present after the surge passed", t !== null);
  check.expectEq("the tower was not tripped by the surge", t.tripped, false);

  // A clip: units walking past the intact tower.
  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  await build(api, "arc", 10, 22);
  for (let i = 0; i < 6; i += 1) await spawn(api, "mote", "left");
  await liveClip(api, 2200);
  return check.verdict();
}
