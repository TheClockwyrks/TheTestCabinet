// Automated validation for the Bonds sub-item `kinetic-fastest`.
//
// Kinetic damage chews through a bond pool faster than energy opens the same cluster.
// The check times how long each of a Cleaver (kinetic) and an Emitter (energy) takes to
// fully open an identical Polymer — the cluster is "opened" when it is no longer bonded
// — and confirms the kinetic tower is faster.

import { startRun, pathGeom, placeCovering, spawnAt, stepUntil, unitById, liveClip, MAP } from "../_helpers.mjs";

async function timeToOpen(api, kind) {
  const snap = await startRun(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  const s0 = g.length * 0.18;
  await placeCovering(api, kind, g, s0);
  // Spawn upstream of the tower's point so the cluster traverses the full coverage
  // window (more in-range time), making the fully-open comparison robust.
  const id = await spawnAt(api, { type: "polymer", pathId: 0, s: s0 - 50 });
  const r = await stepUntil(api, (s) => {
    const u = unitById(s, id);
    return u == null || u.traits.bonded === false;
  }, 8, 0.05);
  return r.snap.simTime;
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("bonds.kinetic-fastest");

  const kinetic = await timeToOpen(api, "cleaver");
  const energy = await timeToOpen(api, "emitter");
  check.expectLt("kinetic (Cleaver) opens a cluster faster than energy (Emitter)", kinetic, energy);

  // Clip a Cleaver tearing a cluster open.
  const snap = await startRun(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  await placeCovering(api, "cleaver", g, g.length * 0.18);
  await spawnAt(api, { type: "polymer", pathId: 0, s: g.length * 0.18 });
  await liveClip(api, 1500);
  return check.verdict();
}
