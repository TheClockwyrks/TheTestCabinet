// Automated validation for the Bullets item `fire-rate`: fire is rate-limited (~0.18 s
// between shots). The ship taps fire, then taps again too soon (which must NOT fire),
// then taps once more after the interval has elapsed (which must fire).

import { newGame, poseShip, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("bullets.fire-rate");

  await newGame(api);
  await poseShip(api, { x: 200, y: 200, vx: 0, vy: 0, angle: (-135 * Math.PI) / 180 });

  await api.call("press", "Space"); // first shot
  check.expectEq("the first tap fires a bullet", (await api.snapshot()).bullets.length, 1);

  await api.step(0.05); // well under the fire interval
  await api.call("press", "Space"); // too soon — must not fire
  check.expectEq("a second tap within the interval does not fire", (await api.snapshot()).bullets.length, 1);

  await api.step(0.15); // now past ~0.18 s since the first shot
  await api.call("press", "Space"); // allowed again
  check.expectEq("a tap after the interval fires again", (await api.snapshot()).bullets.length, 2);

  await liveClip(api, 600);
  return check.verdict();
}
