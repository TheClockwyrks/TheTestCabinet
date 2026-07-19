// Automated validation for pathing.three-maps: the three maps define different ordered
// waypoint chains at pinned coordinates (chosen, not randomly generated).
//
// Each map is started and its reported waypoint chain read; the three signatures must be
// distinct, and re-starting a map twice must reproduce the same chain (pinned, not random).

import { startBuild, snap } from "../_helpers.mjs";

function sig(waypoints) {
  return JSON.stringify(waypoints.map((w) => [w.col, w.row]));
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("pathing.three-maps");

  const sigs = [];
  for (const m of ["substation", "switchyard", "transformer"]) {
    const s = await startBuild(api, { map: m });
    sigs.push(sig(s.waypoints));
  }
  check.expectEq("the three maps report three distinct waypoint chains", new Set(sigs).size, 3);

  // Pinned, not random: re-starting a map reproduces the same chain.
  const again = sig((await startBuild(api, { map: "substation" })).waypoints);
  check.expectEq("a map's waypoint chain is fixed (chosen, not random)", again, sigs[0]);

  await api.screenshot("maps");
  return check.verdict();
}
