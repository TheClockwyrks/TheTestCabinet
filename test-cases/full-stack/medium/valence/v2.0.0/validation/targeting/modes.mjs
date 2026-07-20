// Automated validation for the Targeting sub-item `modes`.
//
// Setting a tower's targeting priority changes which valid in-range unit it fires at.
// The check poses three real atoms whose progress, distance-from-tower, and hit points
// are each arranged so every priority resolves to a distinct, well-defined unit:
//   A — least progress, farthest from the tower, most hit points
//   B — middle progress, nearest the tower, fewest hit points
//   C — most progress
// Each priority is checked from a fresh scene (a single real step, before any shot
// lands) so the acquired target reflects the priority alone.

import { startRun, pathGeom, placeCovering, spawnAt, liveClip, FIXED, MAP } from "../_helpers.mjs";

async function pick(api, mode) {
  const snap = await startRun(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  const s0 = g.length * 0.22;
  const t = await placeCovering(api, "beam", g, s0);
  const A = await spawnAt(api, { type: "atom", electrons: 6, pathId: 0, s: s0 - 150 });
  const B = await spawnAt(api, { type: "atom", electrons: 1, pathId: 0, s: s0 });
  const C = await spawnAt(api, { type: "atom", electrons: 3, pathId: 0, s: s0 + 110 });
  if (mode !== "first") await api.call("setTargeting", t.id, mode);
  await api.step(FIXED);
  const tower = (await api.snapshot()).towers.find((x) => x.id === t.id);
  return { targetId: tower.targetId, A, B, C };
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("targeting.modes");

  const last = await pick(api, "last");
  check.expectEq("LAST targets the least-advanced unit", last.targetId, last.A);
  const nearest = await pick(api, "nearest");
  check.expectEq("NEAREST targets the unit closest to the tower", nearest.targetId, nearest.B);
  const farthest = await pick(api, "farthest");
  check.expectEq("FARTHEST targets the unit most distant from the tower", farthest.targetId, farthest.A);
  const strongest = await pick(api, "strongest");
  check.expectEq("STRONGEST targets the highest-hp unit", strongest.targetId, strongest.A);
  const weakest = await pick(api, "weakest");
  check.expectEq("WEAKEST targets the lowest-hp unit", weakest.targetId, weakest.B);

  await liveClip(api, 1000);
  return check.verdict();
}
