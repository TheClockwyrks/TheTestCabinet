// Automated validation for the Bonds sub-item `kinetic-fastest`.
//
// Kinetic damage chews through a bond pool faster than energy does. specs/matter.md pins
// exactly why, and it is a property of the SHOT, not of a stopwatch: "Kinetic damage is best
// against bonds: a kinetic shot deals its damage to the bond pool times a bonus (base ×2)",
// while every other type "chip[s] the same bonds, slower rather than never" — normal damage
// to the pool (the damage-vs-traits table: kinetic "×2 (Cleaver deepens)", energy "normal").
//
// So the check measures the FIRST SHOT each tower lands on an identical Polymer and compares
// the bond it removed against that tower's own reported `damage`: a Cleaver's shot must take
// twice its damage off the pool, an Emitter's exactly its damage. That is the bonus itself,
// and it is independent of fire rate — where the previous "how much did each remove in 135
// ticks, and is kinetic at least twice energy" reading was not. Two towers with different
// fire rates land a different NUMBER of shots in a fixed window, so that ratio measured shot
// quantization as much as the bonus: it was tuned until the reference happened to sit at
// exactly 2.0 (the old comment recorded the tuning — "Empirically the ratio sits stably at
// 2.0 (kinetic 8, energy 4) across ~110-160 ticks; 135 is its centre"), which a conformant
// build that starts its cooldowns a shot out of step would miss while applying the bonus
// perfectly. The fixed window survives as the coarse, robust claim it can honestly support:
// over the same span kinetic removes more pool than energy.
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
  TICK,
  MAP,
} from "../_helpers.mjs";

// The coarse comparison's span. Long enough for the low-fire-rate Cleaver (1.2 shots/s) to
// land several bond hits; nothing about the verdict now rests on where exactly it falls.
const WINDOW_TICKS = 135;
// specs/matter.md: a kinetic shot's damage to a bond pool is multiplied by this at base
// (the Cleaver's REND branch deepens it to ×3, which is not taken here).
const KINETIC_BOND_BONUS = 2;

/** Pose one tower/Polymer scenario; `begin` opens the run (`startRun` or `poseRun`). */
async function poseScenario(api, kind, begin) {
  const snap = await begin(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  const tower = await placeCovering(api, kind, g, g.length * 0.4);
  await focusOnParent(api);
  const towerSnap = towerById(await api.snapshot(), tower.id);
  const s = firstInRange(g, towerSnap);
  const id = await spawnAt(api, { type: "polymer", pathId: 0, s });
  return {
    id,
    towerId: tower.id,
    damage: towerSnap.damage,
    before: unitById(await api.snapshot(), id),
  };
}

/**
 * Run one posed scenario and report both readings: the bond its FIRST landed shot removed
 * (the bonus itself), and how much of the pool was gone by the end of the fixed window.
 */
async function bondRemovedIn(api, posed) {
  const { id, before } = posed;
  // The first shot's own bite. Polled every TICK, since the pool falls on the single step
  // the projectile lands — a coarser poll could fold a second shot into the reading.
  let prev = before.bond;
  let perShot = 0;
  const first = await api.until(
    (s) => {
      const u = unitById(s, id);
      const bond = u?.bond ?? 0;
      if (bond < prev) {
        perShot = prev - bond;
        return true;
      }
      prev = bond;
      return false;
    },
    { max: WINDOW_TICKS, poll: TICK },
  );

  await api.advance(WINDOW_TICKS - first.spent);
  const after = unitById(await api.snapshot(), id);
  // A unit that opened during the window reports no bond at all; treat that as the whole
  // pool gone, which is exactly what it is.
  const left = after == null || after.bond == null ? 0 : after.bond;
  return {
    ...posed,
    landed: first.hit,
    perShot,
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
      check.expectOk("the Cleaver landed a shot on the pool", kinetic.landed);
      check.expectOk("the Emitter landed a shot on the pool", energy.landed);

      // The bonus itself, read off one shot from each tower against its own damage.
      check.expectEq(
        "an energy shot takes its plain damage off the bond pool",
        energy.perShot,
        energy.damage,
      );
      check.expectEq(
        "a kinetic shot takes DOUBLE its damage off the bond pool",
        kinetic.perShot,
        kinetic.damage * KINETIC_BOND_BONUS,
      );
      check.expectGt(
        "so one kinetic shot bites deeper into the pool than one energy shot",
        kinetic.perShot,
        energy.perShot,
      );

      // ...and the coarse consequence over the same span of game time.
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
    },
  };
}
