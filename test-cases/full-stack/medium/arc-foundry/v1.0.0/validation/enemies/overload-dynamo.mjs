// Automated validation for enemies.overload-dynamo: after the final wave an invincible Overload
// Dynamo walks the maze once — it takes no HP loss, costs no integrity, and grounding out wins
// the run.
//
// The post-final boss is released through the real spawner ("overload"); it must report as
// invincible, its HP must not fall as it walks, and grounding out at the Collector must win
// (Victory) rather than cost integrity.

import { startBuild, spawnControlled, unitById, snap, stepUntil, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("enemies.overload-dynamo");

  await startBuild(api, { difficulty: "easy" });
  await api.call("setIntegrity", 20);
  const i0 = (await snap(api)).integrity;

  const [d] = await spawnControlled(api, "overload");
  check.expectOk("an Overload Dynamo was released", !!d);
  check.expectEq("it is invincible", d.invincible, true);
  const hp0 = d.hp;

  await liveClip(api, 2500); // the boss looming down the maze
  await api.call("setAutoStep", false);

  // It never loses HP as it is worn on; the run wins when it grounds out.
  let hpDropped = false;
  const r = await stepUntil(api, (s) => {
    const l = unitById(s, d.id);
    if (l && l.hp < hp0) hpDropped = true;
    return s.screen === "victory" || !unitById(s, d.id);
  }, 150, 0.5);

  const s = await snap(api);
  check.expectOk("the Overload Dynamo took no HP loss (invincible)", !hpDropped);
  check.expectOk("grounding out won the run (Victory)", r.hit && s.screen === "victory");
  check.expectGe("no Grid Integrity was spent on the invincible boss", s.integrity, i0);

  return check.verdict();
}
