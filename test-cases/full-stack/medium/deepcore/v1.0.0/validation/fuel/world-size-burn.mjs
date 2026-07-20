// Automated validation for fuel.world-size-burn.
//
// The jetpack thrust burn is scaled by the world size so the fuel clock stays proportional to the
// descent: a shallow Quick mine burns thrust ~2x as fast as a Standard mine and a deep Marathon
// ~0.67x. We hold thrust for the same time from the same standing start in a Quick, a Standard, and
// a Marathon mine and compare the fuel burned. Only the thrust burn scales, so the ordering is
// Quick > Standard > Marathon, and Quick is well over twice the Marathon burn.

import { K, newRun, openColumn, solid, SPAWN_COL, holdFor } from "../_helpers.mjs";

async function thrustBurn(api, size) {
  const col = SPAWN_COL;
  const row = 60; // a shallow row that exists at every size (topsoil)
  await newRun(api, { size });
  await openColumn(api, col, 24, row); // open shaft above so the miner rises
  await solid(api, col, row + 1); // a floor to stand on
  await api.call("teleport", col, row);
  await api.call("grantGear", { fuel: 5, jetpack: 3 }); // plenty of fuel; refilled to max
  await api.call("teleport", col, row);
  const f0 = (await api.snapshot()).miner.fuel;
  const snap = await holdFor(api, K.thrust, 0.5); // hold thrust for exactly 0.5 s
  return f0 - snap.miner.fuel;
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("fuel.world-size-burn");

  const quick = await thrustBurn(api, "quick");
  const standard = await thrustBurn(api, "standard");
  const marathon = await thrustBurn(api, "marathon");

  check.expectGt("thrust burns fuel at every size", marathon, 0.5);
  check.expectGt("a Quick mine burns thrust faster than Standard", quick, standard);
  check.expectGt("a Standard mine burns thrust faster than Marathon", standard, marathon);
  check.expectGt("a Quick mine burns well over twice a Marathon's thrust", quick, marathon * 2);

  await api.call("setAutoStep", true);
  await api.wait(600);
  return check.verdict();
}
