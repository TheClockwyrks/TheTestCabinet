// Automated validation for the Conduction sub-item `movers-inert`.
//
// The Forge and Sink have no heat of their own — a hot emitter touching one does not
// heat the mover up (specs/heat.md). We place a hot Arc between a Forge and a Sink,
// step the real heat model, and confirm both movers stay at heat 0.

import { newGame, build, tower } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("conduction.movers-inert");

  await newGame(api, "containment", "medium", 100000);
  const arc = await build(api, "arc", 12, 12);
  const forge = await build(api, "forge", 12, 10); // N face
  const sink = await build(api, "sink", 12, 14); // S face
  await api.call("setHeat", arc, 95);

  await api.step(1);
  check.expectClose("the Forge gains no heat from a hot neighbor", (await tower(api, forge)).heat, 0, 0.01);
  check.expectClose("the Sink gains no heat from a hot neighbor", (await tower(api, sink)).heat, 0, 0.01);

  await api.wait(80);
  await api.screenshot("movers");
  return check.verdict();
}
