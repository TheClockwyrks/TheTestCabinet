// Automated validation for the Hunter item `second-bear`.
//
// From level 5 the strait fields two hunters; both eventually emerge and pursue.
// The level is set to 5 (two hunter slots), the critter advanced onto a safe floe,
// and the real emerge logic brings both bears out, which the snapshots read back.
// See validation/_helpers.mjs.

import { stepUntil } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("hunter.second-bear");

  await api.reset();
  await api.call("setLevel", 5);
  check.expectEq("level 5 fields two hunter slots", (await api.snapshot()).bears.length, 2);

  await api.call("setLane", 3, { cols: [20], speed: 0 }); // safe floe up top
  await api.call("placeCritter", 20, 3); // advanced, so both may emerge
  const r = await stepUntil(
    api,
    (s) => s.bears.length === 2 && s.bears[0].present && s.bears[1].present,
    3,
    0.1,
  );
  check.expectOk("both bears eventually emerge", r.hit);

  // Clip: both hunters emerging and pursuing in real time.
  await api.reset();
  await api.call("setLevel", 5);
  await api.call("setLane", 3, { cols: [20], speed: 0 });
  await api.call("placeCritter", 20, 3);
  await api.wait(3000);

  return check.verdict();
}
