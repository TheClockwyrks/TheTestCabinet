// Automated validation for the Rotation sub-item `changes-outcome`.
//
// In the same spot with the same faces blocked, aiming a radiator face at the open
// air cools better than aiming a plain face there — so orientation is a real cooling
// lever (specs/heat.md). We block an Arc's N, S, and W faces with Sinks (equal in
// both cases, so they cancel) and leave the E face on open air; at one rotation a
// radiator face points E, at the other a plain face does. The radiator-facing
// placement must end cooler after the same real cooling step.

import { newGame, build, heatOf, liveClip } from "../_helpers.mjs";

// Place an Arc at `rot` with N/S/W blocked by Sinks and E on open air; pose it hot
// and cool it for `secs`, returning its final heat.
async function coolOneOpenFace(api, rot, secs) {
  await newGame(api, "containment", "medium", 100000);
  const id = await build(api, "arc", 12, 12, rot);
  await build(api, "sink", 12, 10); // N
  await build(api, "sink", 12, 14); // S
  await build(api, "sink", 10, 12); // W
  await api.call("setHeat", id, 80);
  await api.step(secs);
  return heatOf(api, id);
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("rotation.changes-outcome");

  const radiatorOnOpen = await coolOneOpenFace(api, 1, 0.6); // rot 1: a radiator points E
  const plainOnOpen = await coolOneOpenFace(api, 0, 0.6); // rot 0: a plain face points E

  check.expectLt(
    "the same spot cools better with a radiator face on the open air",
    radiatorOnOpen,
    plainOnOpen,
  );

  await newGame(api, "containment", "medium", 100000);
  const c = await build(api, "arc", 12, 12, 1);
  await build(api, "sink", 12, 10);
  await build(api, "sink", 12, 14);
  await build(api, "sink", 10, 12);
  await api.call("setHeat", c, 92);
  await liveClip(api, 1600);
  return check.verdict();
}
