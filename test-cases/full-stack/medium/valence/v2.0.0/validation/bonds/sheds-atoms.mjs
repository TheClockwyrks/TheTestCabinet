// Automated validation for the Bonds sub-item `sheds-atoms`.
//
// As its bond pool depletes a cluster sheds its constituent atoms as a spray of free
// atoms, rather than vanishing whole. A `k`-atom cluster sheds `k − 1` atoms as the pool
// drains and continues as the final free atom, so it releases exactly `k` in all. The
// check chips a Polymer (6 atoms) open with a Cleaver, counting every distinct free atom
// it ever releases — tracked across steps, so an atom neutralized before the next read is
// still counted — and confirms all six arrive.
//
// The Cleaver is pointed at the LAST unit in range: freed atoms are shed just AHEAD of
// their parent, so a tower on the default FIRST priority would abandon the cluster for
// them and the pool would never finish draining.

import { startRun, pathGeom, placeCovering, spawnAt, stepUntil, unitById, focusOnParent, liveClip, MAP } from "../_helpers.mjs";

const POLYMER_ATOMS = 6; // MATTER.polymer.atoms — specs/matter.md
const MAX_OPEN_SECONDS = 30;

export default async function drive(api, ttc) {
  const check = ttc.checkOne("bonds.sheds-atoms");

  const snap = await startRun(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  const s0 = g.length * 0.18;
  await placeCovering(api, "cleaver", g, s0);
  await focusOnParent(api);
  // Spawn upstream so the cluster traverses the tower's full coverage window.
  const id = await spawnAt(api, { type: "polymer", pathId: 0, s: s0 - 50 });

  const seen = new Set();
  const r = await stepUntil(api, (s) => {
    for (const u of s.matter) if (u.type === "atom") seen.add(u.id);
    const u = unitById(s, id);
    return u == null || u.traits.bonded === false;
  }, MAX_OPEN_SECONDS, 0.05);
  // Include the final converted atom (the cluster itself, once fully opened).
  for (const u of (await api.snapshot()).matter) if (u.type === "atom") seen.add(u.id);

  check.expectOk("the cluster opened", r.hit);
  check.expectGe("a cluster sheds a spray of free atoms (more than one)", seen.size, 2);
  check.expectEq("a 6-atom cluster releases exactly its six atoms", seen.size, POLYMER_ATOMS);

  await liveClip(api, 1400);
  return check.verdict();
}
