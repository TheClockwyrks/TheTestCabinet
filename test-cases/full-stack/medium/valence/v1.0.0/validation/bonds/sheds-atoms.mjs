// Automated validation for the Bonds sub-item `sheds-atoms`.
//
// As its bond pool depletes a cluster sheds its constituent atoms as a spray of free
// atoms, rather than vanishing whole. The check chips a Polymer open with a Cleaver and
// counts how many distinct free atoms it ever sheds (tracked across steps, so a tower
// that neutralizes a shed atom before the next read is still counted): a cluster sheds
// more than one.

import { startRun, pathGeom, placeCovering, spawnAt, stepUntil, unitById, liveClip, MAP } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("bonds.sheds-atoms");

  const snap = await startRun(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  const s0 = g.length * 0.18;
  await placeCovering(api, "cleaver", g, s0);
  // Spawn upstream so the cluster traverses the tower's full coverage window.
  const id = await spawnAt(api, { type: "polymer", pathId: 0, s: s0 - 50 });

  const seen = new Set();
  const r = await stepUntil(api, (s) => {
    for (const u of s.matter) if (u.type === "atom") seen.add(u.id);
    const u = unitById(s, id);
    return u == null || u.traits.bonded === false;
  }, 8, 0.05);
  // Include the final converted atom (the cluster itself, once fully opened).
  for (const u of (await api.snapshot()).matter) if (u.type === "atom") seen.add(u.id);

  check.expectOk("the cluster opened", r.hit);
  check.expectGe("a cluster sheds a spray of free atoms (more than one)", seen.size, 2);

  await liveClip(api, 1400);
  return check.verdict();
}
