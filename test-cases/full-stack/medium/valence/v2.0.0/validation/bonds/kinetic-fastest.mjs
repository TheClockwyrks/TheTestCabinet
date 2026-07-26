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
//
// TWO runs, so the second is opened with `poseRun` rather than `startRun`: `api.reset`
// throws inside `act`, and posing reaches the same fresh run with control ops alone.

import {
  startRun,
  poseRun,
  pathGeom,
  placeCovering,
  spawnAt,
  unitById,
  towerById,
  firstInRange,
  focusOnParent,
  MAP,
} from "../_helpers.mjs";

// 135 ticks (~2.25 s). The window must be long enough that the low-fire-rate Cleaver
// (1.2 shots/s) lands its SECOND bond hit — a 90-tick window caught only one, so it
// measured shot-count quantization (kinetic 4 vs energy 3) rather than the x2 bond bonus
// the impl actually applies. Yet it must stay short enough that the Cleaver has NOT spent
// the 11-point pool: once it opens the cluster its "removed" caps at the pool size while
// the faster Emitter keeps accumulating, and the ratio collapses again. Empirically the
// ratio sits stably at 2.0 (kinetic 8, energy 4) across ~110-160 ticks; 135 is its centre.
const WINDOW_TICKS = 135;

/** Pose one tower/Polymer scenario; `begin` opens the run (`startRun` or `poseRun`). */
async function poseScenario(api, kind, begin) {
  const snap = await begin(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  const tower = await placeCovering(api, kind, g, g.length * 0.4);
  await focusOnParent(api);
  const s = firstInRange(g, towerById(await api.snapshot(), tower.id));
  const id = await spawnAt(api, { type: "polymer", pathId: 0, s });
  return { id, before: unitById(await api.snapshot(), id) };
}

/** Run one posed scenario for the fixed window and report how much bond it removed. */
async function bondRemovedIn(api, { id, before }) {
  await api.advance(WINDOW_TICKS);
  const after = unitById(await api.snapshot(), id);
  // A unit that opened during the window reports no bond at all; treat that as the whole
  // pool gone, which is exactly what it is.
  const left = after == null || after.bond == null ? 0 : after.bond;
  return {
    removed: before.bond - left,
    opened: after == null || after.traits.bonded === false,
  };
}

export default function item() {
  let posedKinetic;
  let kinetic;
  let energy;

  return {
    id: "bonds.kinetic-fastest",

    // Only the FIRST scenario can be arranged — it is the one that opens from a seeded
    // reset. The energy comparison is posed inside `act`.
    async arrange(api) {
      posedKinetic = await poseScenario(api, "cleaver", startRun);
    },

    // Both measured windows, back to back: the Cleaver tearing at the pool, then the same
    // scenario under an Emitter. That side-by-side is the clip the reviewer needs.
    async act(api) {
      kinetic = await bondRemovedIn(api, posedKinetic);

      // Second run, posed with control ops only (`poseRun`) — `api.reset` would take the
      // clock back and freeze the recording.
      const posedEnergy = await poseScenario(api, "emitter", poseRun);
      energy = await bondRemovedIn(api, posedEnergy);
    },

    async assert(api, check) {
      check.expectGt(
        "an energy tower does chip the bond pool",
        energy.removed,
        0,
      );
      check.expectGt(
        "kinetic (Cleaver) removes more bond than energy (Emitter) in the same time",
        kinetic.removed,
        energy.removed,
      );
      check.expectGe(
        "kinetic's bond bonus makes it at least twice as fast",
        kinetic.removed,
        energy.removed * 2,
      );
    },
  };
}
