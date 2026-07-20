// Automated validation for the Trip sub-item `returns-cold`.
//
// After about five seconds offline a tripped tower comes back online cold
// (specs/heat.md). We first trip a real emitter (firing carries it to 100 from a
// near-redline precondition), then step past the cooldown and read that it is back
// online with heat 0 — the real trip cooldown resolves it.

import { newGame, combatSetup, tower, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("trip.returns-cold");

  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const { id } = await combatSetup(api, "stutter");
  await api.call("setHeat", id, 92);

  const tripped = await stepUntil(api, (s) => s.towers.some((t) => t.id === id && t.tripped), 6);
  check.expectOk("the emitter tripped", tripped.hit);

  const back = await stepUntil(api, (s) => s.towers.some((t) => t.id === id && !t.tripped), 7);
  const t = await tower(api, id);
  check.expectOk("the tower came back online", back.hit);
  check.expectEq("it is online again", t.tripped, false);
  check.expectClose("it returns cold (heat 0)", t.heat, 0, 0.5);

  // A clip: an emitter tripping and cooling back to online.
  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const c = await combatSetup(api, "stutter");
  await api.call("setHeat", c.id, 92);
  await liveClip(api, 2600);
  return check.verdict();
}
