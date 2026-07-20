// Automated validation for the Trip sub-item `strobing-red`.
//
// While offline a tripped tower is drawn strobing red (specs/heat.md), so a gapped
// kill-box reads at a glance. The check trips a real emitter, then samples the
// pixels it actually RENDERS on its body — red must dominate both other channels
// (both strobe frames are red). Reading the rendered pixel means a build cannot pass
// by a color it does not draw. A Lance is used because its large footprint gives a
// broad solid body to sample, well clear of the cyan radiator fins at the edges.

import { newGame, combatSetup, tower, stepUntil, sampleTowerBody } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("trip.strobing-red");

  await newGame(api, "containment", "medium", 100000);
  await api.call("setLives", 100000);
  const { id } = await combatSetup(api, "lance");
  await api.call("setHeat", id, 92);

  const r = await stepUntil(api, (s) => s.towers.some((t) => t.id === id && t.tripped), 6);
  check.expectOk("the emitter tripped", r.hit);

  await api.wait(90);
  const body = await sampleTowerBody(api, await tower(api, id));
  check.expectGt("a tripped tower's red channel dominates green", body.r, body.g + 30);
  check.expectGt("a tripped tower's red channel dominates blue", body.r, body.b + 30);

  await api.screenshot("strobe");
  return check.verdict();
}
