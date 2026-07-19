// Automated validation for the Gravity item `saucer-free`: the saucer is a powered craft
// and is never pulled by the star. A saucer is posed well off the star (clear of its
// avoidance radius) crossing horizontally with no vertical velocity; after the real sim
// steps it must not have gained any velocity toward the star — a rock in the same spot
// would curve toward it.

import { newGame, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("gravity.saucer-free");

  await newGame(api);
  await api.call("spawnSaucer");
  await api.call("setSaucer", { x: 200, y: 200, vx: 140, vy: 0 });

  await api.step(0.5);
  const s = (await api.snapshot()).saucer;
  check.expectOk("the saucer is on the field", Boolean(s));
  check.expectClose("the saucer gains no vertical pull toward the star", s.vy, 0, 0.5);
  check.expectClose("it holds its height (it is not pulled toward the star)", s.y, 200, 2);

  await newGame(api);
  await api.call("spawnSaucer");
  await api.call("setSaucer", { x: 200, y: 200, vx: 140, vy: 0 });
  await liveClip(api, 800);
  return check.verdict();
}
