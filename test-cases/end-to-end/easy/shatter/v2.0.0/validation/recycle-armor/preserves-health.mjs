// Automated validation (Warhead) for the Recycle-armor item `preserves-health`: a damaged
// rock recycled by the star re-enters with the SAME remaining health — the star relocates
// it, it does not repair it. A Large already chipped to 1 HP is aimed into the core; after
// the star recycles it, it must still be a Large at 1 HP (not restored to 3).

import { newGame, stepUntilRecycled, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("recycle-armor.preserves-health");

  await newGame(api);
  await api.call("addRock", "large", { x: 640, y: 200, vx: 0, vy: 240, health: 1 });

  const { recycled, snap } = await stepUntilRecycled(api, { maxSeconds: 2 });

  check.expectOk("the damaged rock is recycled by the star", recycled);
  check.expectEq("the recycled rock is still a Large (relocated, not replaced)", snap.rocks[0] ? snap.rocks[0].size : "gone", "large");
  check.expectEq("the recycle preserves its 1 HP — the star does not repair it", snap.rocks[0] ? snap.rocks[0].health : -1, 1);

  await newGame(api);
  await api.call("addRock", "large", { x: 640, y: 200, vx: 0, vy: 240, health: 1 });
  await liveClip(api, 900);
  return check.verdict();
}
