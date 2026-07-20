// Automated validation for the Controls item `fire-space`: Space fires a bullet. The ship
// is posed in play; Space is tapped and a new bullet must appear. Injected input flows
// through the real key handling.

import { newGame, poseShip, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.fire-space");

  await newGame(api);
  await poseShip(api, { x: 300, y: 560, vx: 0, vy: 0, angle: 0 });
  check.expectEq("no bullets before firing", (await api.snapshot()).bullets.length, 0);

  await api.call("press", "Space");
  check.expectEq("tapping Space fires a bullet", (await api.snapshot()).bullets.length, 1);

  await liveClip(api, 600);
  return check.verdict();
}
