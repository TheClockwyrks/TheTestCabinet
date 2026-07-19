// Automated validation for the Surface-cooling sub-item `radiator-better`.
//
// The radiator faces shed heat far better than plain faces (specs/heat.md). With an
// Arc's east and west faces blocked (by Sinks, which cool both cases equally so they
// cancel out of the comparison), the only difference is which faces point at the
// open N/S air: at rotation 0 the Arc's radiator faces do, at rotation 1 its plain
// faces do. The radiator-facing placement must end cooler after the same real
// cooling step.

import { newGame, build, heatOf, liveClip } from "../_helpers.mjs";

// Place an Arc at `rot` with Sinks blocking its E and W faces; pose it hot and cool
// it for `secs`, returning its final heat.
async function coolBlocked(api, rot, secs) {
  await newGame(api, "containment", "medium", 100000);
  const id = await build(api, "arc", 12, 12, rot);
  await build(api, "sink", 10, 12); // W
  await build(api, "sink", 14, 12); // E
  await api.call("setHeat", id, 80);
  await api.step(secs);
  return heatOf(api, id);
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("cooling.radiator-better");

  const radOpen = await coolBlocked(api, 0, 0.5); // radiator faces (N,S) on open air
  const plainOpen = await coolBlocked(api, 1, 0.5); // plain faces on open air

  check.expectLt("radiator faces on open air cool faster than plain faces", radOpen, plainOpen);

  // A clip: the radiator-facing placement cooling.
  await newGame(api, "containment", "medium", 100000);
  const c = await build(api, "arc", 12, 12, 0);
  await build(api, "sink", 10, 12);
  await build(api, "sink", 14, 12);
  await api.call("setHeat", c, 92);
  await liveClip(api, 1600);
  return check.verdict();
}
