// Automated validation for the Ice band item `lanes`.
//
// The ice band is eight solid lanes (rows 11..18), each carrying sliding
// multi-tile vehicles (a 3-tile plow, a 2-tile dogsled, a 2-tile car), moving in
// alternating directions. Read straight from the snapshot after a fresh crossing.
// See validation/_helpers.mjs.

import { startCrossing, ICE_TOP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("ice.lanes");

  await startCrossing(api);
  const s = await api.snapshot();
  const ice = s.lanes.ice;

  check.expectEq("eight ice-band lanes", ice.length, 8);
  for (let i = 0; i < ice.length; i += 1) {
    check.expectEq(`ice lane ${i} is at row ${ICE_TOP + i}`, ice[i].row, ICE_TOP + i);
    check.expectGt(`ice lane ${i} carries vehicles`, ice[i].items.length, 0);
  }

  // The three vehicle kinds are all present, at their native lengths.
  const items = ice.flatMap((l) => l.items);
  const byKind = {};
  for (const v of items) byKind[v.kind] = v.len;
  check.expectOk("a 3-tile plow is present", byKind.plow === 3);
  check.expectOk("a 2-tile dogsled is present", byKind.dogsled === 2);
  check.expectOk("a 2-tile car is present", byKind.car === 2);

  // Directions alternate lane to lane.
  for (let i = 1; i < ice.length; i += 1) {
    check.expectEq(`ice lane ${i} runs opposite lane ${i - 1}`, ice[i].dir, -ice[i - 1].dir);
  }

  await api.wait(120);
  await api.screenshot("scene");

  return check.verdict();
}
