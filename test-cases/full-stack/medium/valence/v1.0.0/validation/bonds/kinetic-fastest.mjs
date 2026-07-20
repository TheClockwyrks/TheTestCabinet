// Automated validation for the Bonds sub-item `kinetic-fastest`.
//
// Kinetic damage chews through a bond pool faster than energy does — a Cleaver's shot
// carries a bonus against bonds that no energy tower gets. The check gives a Cleaver
// (kinetic) and an Emitter (energy) exactly the same scenario — an identical Polymer
// posed at the upstream edge of an identically-placed tower's range — runs each for the
// same fixed span of game time, and compares how much of the bond pool each removed.
//
// Measuring a fixed window rather than "time to fully open" is deliberate: an energy
// tower deliberately CANNOT open a Polymer in one pass, so a time-to-open comparison
// would only ever record two timeouts. The window is short enough that neither tower has
// exhausted the pool, so both figures are the real chip rate.
//
// Each tower is pointed at the LAST unit in range: a cluster sheds its freed atoms just
// AHEAD of itself, so a tower on the default FIRST priority would abandon the pool it is
// supposed to be chipping.

import { startRun, pathGeom, placeCovering, spawnAt, unitById, towerById, firstInRange, focusOnParent, liveClip, MAP } from "../_helpers.mjs";

const WINDOW_SECONDS = 1.5; // short enough that neither tower has spent the pool

async function bondRemovedIn(api, kind) {
  const snap = await startRun(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  const tower = await placeCovering(api, kind, g, g.length * 0.4);
  await focusOnParent(api);
  const s = firstInRange(g, towerById(await api.snapshot(), tower.id));
  const id = await spawnAt(api, { type: "polymer", pathId: 0, s });
  const before = unitById(await api.snapshot(), id);
  await api.step(WINDOW_SECONDS);
  const after = unitById(await api.snapshot(), id);
  // A unit that opened during the window reports no bond at all; treat that as the whole
  // pool gone, which is exactly what it is.
  const left = after == null || after.bond == null ? 0 : after.bond;
  return { removed: before.bond - left, opened: after == null || after.traits.bonded === false };
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("bonds.kinetic-fastest");

  const kinetic = await bondRemovedIn(api, "cleaver");
  const energy = await bondRemovedIn(api, "emitter");

  check.expectGt("an energy tower does chip the bond pool", energy.removed, 0);
  check.expectGt("kinetic (Cleaver) removes more bond than energy (Emitter) in the same time", kinetic.removed, energy.removed);
  check.expectGe("kinetic's bond bonus makes it at least twice as fast", kinetic.removed, energy.removed * 2);

  // Clip a Cleaver tearing a cluster open.
  const snap = await startRun(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  await placeCovering(api, "cleaver", g, g.length * 0.18);
  await spawnAt(api, { type: "polymer", pathId: 0, s: g.length * 0.18 });
  await liveClip(api, 1500);
  return check.verdict();
}
