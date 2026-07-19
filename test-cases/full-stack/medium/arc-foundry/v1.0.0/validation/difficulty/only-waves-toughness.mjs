// Automated validation for difficulty.only-waves-toughness: Easy / Medium / Hard change only
// the wave count and enemy HP scaling; starting Charge, Grid Integrity, and the five-stamp
// allowance are identical on all three.

import { startBuild, spawnControlled, DIFFICULTY, START_CHARGE, START_INTEGRITY, snap } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("difficulty.only-waves-toughness");

  for (const d of ["easy", "medium", "hard"]) {
    const s = await startBuild(api, { difficulty: d });
    check.expectEq(`${d} total waves`, s.totalWaves, DIFFICULTY[d].waves);
    check.expectEq(`${d} starting Charge is identical`, s.charge, START_CHARGE);
    check.expectEq(`${d} starting Grid Integrity is identical`, s.integrity, START_INTEGRITY);
    check.expectEq(`${d} five-stamp allowance is identical`, s.stampsLeft, 5);
  }

  // HP scaling differs by difficulty; speed does not.
  await startBuild(api, { difficulty: "easy" });
  const [me] = await spawnControlled(api, "mote", { wave: 1 });
  await startBuild(api, { difficulty: "hard" });
  const [mh] = await spawnControlled(api, "mote", { wave: 1 });
  check.expectNe("enemy HP scaling differs by difficulty", me.maxHp, mh.maxHp);
  check.expectEq("...but enemy speed is identical", me.baseSpeed, mh.baseSpeed);

  await api.screenshot("diff");
  return check.verdict();
}
