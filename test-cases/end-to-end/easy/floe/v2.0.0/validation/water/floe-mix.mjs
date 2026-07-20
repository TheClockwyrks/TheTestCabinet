// Automated validation for the Water band item `floe-mix`.
//
// Floes are a mix of 1-tile pans and solid 3-tile and 4-tile rafts (each raft one
// continuous piece, not tiled pans). Read straight from the snapshot: the kinds
// present and their native lengths. See validation/_helpers.mjs.

import { startCrossing } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("water.floe-mix");

  await startCrossing(api);
  const items = (await api.snapshot()).lanes.water.flatMap((l) => l.items);
  const byKind = {};
  for (const f of items) byKind[f.kind] = f.len;

  check.expectOk("single-tile pans are present", byKind.pan !== undefined);
  check.expectOk("3-tile rafts are present", byKind.raft3 !== undefined);
  check.expectOk("4-tile rafts are present", byKind.raft4 !== undefined);
  check.expectEq("a pan is one tile", byKind.pan, 1);
  check.expectEq("a raft3 is a solid 3 tiles", byKind.raft3, 3);
  check.expectEq("a raft4 is a solid 4 tiles", byKind.raft4, 4);

  await api.wait(120);
  await api.screenshot("scene");

  return check.verdict();
}
