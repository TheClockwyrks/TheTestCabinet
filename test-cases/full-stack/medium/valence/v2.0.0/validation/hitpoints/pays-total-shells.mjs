// Automated validation for the Hit Points sub-item `pays-total-shells`.
//
// A unit pays out exactly its TOTAL SHELLS over its lifetime — its own hit points plus
// everything it fragments into — because energy is earned per shell stripped rather than
// as a lump on the kill. The check drives two units all the way down from an empty bank
// and reads the bank at the end:
//
//   * a 3-electron atom, which is 3 shells and nothing else, pays exactly 3;
//   * a Dimer, which is a bond pool of 5 over two atoms of 3, pays exactly 11 — and only
//     once every one of those pieces has itself been stripped.
//
// Score tracks the same amounts, so it is read alongside. Nothing may leak: a unit that
// reaches the collector stops paying, so the check also confirms the board was cleared.
//
// TWO runs are measured; only the first is arranged, and the Dimer run is posed inside
// `act` with `poseScenario` (control ops only — `api.reset` throws there). The old script
// opened a THIRD run purely to film an atom being paid for; `act` already films exactly
// that, so it is gone.

import {
  startScenario,
  poseScenario,
  pathGeom,
  placeCovering,
  battery,
  spawnAt,
  unitById,
  towerById,
  firstInRange,
  clipBudget,
  LEAD_TICKS,
  TAIL_TICKS,
  MAP,
} from "../_helpers.mjs";

const ATOM3_TOTAL_SHELLS = 3; // a 3-electron atom is 3 shells — specs/matter.md
const DIMER_TOTAL_SHELLS = 11; // bond 5 + 2 atoms of 3 — specs/matter.md
const MAX_CLEAR_TICKS = 2400; // 2400 ticks = the old 40 s cap — game time, not wall clock

// WHY THE APPROACH IS SKIPPED AND ONLY THE PAYOUT IS FILMED.
//
// Both scenarios here are long: a Dimer released at the inlet walks a fifth of the lane
// before the first Cleaver can touch it, and the whole cascade — pool, then two atoms — has
// to be stripped before the eleven is on the board. Filmed in real time that is far more
// than the runtime's 8 s budget, so the record pass ran out partway through the FIRST
// scenario and the Dimer's payout, which is the one the item's headline number is about,
// never reached the clip at all. That is what "it only paid 7 of the 11 it expects" was
// looking at: a truncated film of a verdict that had already been decided correctly by the
// uncapped validate pass.
//
// So the run-in is skipped (instant in both passes, films nothing) and the clip picks up
// where the energy actually starts moving. What a reviewer sees is the bank at 0, the unit
// coming apart under fire, and the total it settles on — which is the claim.
const APPROACH_MAX_TICKS = 3600;
// Enough of the cascade left unskipped to be worth watching, on top of the run-in.
const PAYOUT_TICKS = 300;

/**
 * A lone atom under one tower, posed at the upstream edge of its range so it travels
 * the whole in-range window — the dwell needed to strip it all the way down.
 */
async function poseLoneAtom(api, begin) {
  const snap = await begin(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  const tower = await placeCovering(api, "emitter", g, g.length * 0.5);
  const s = firstInRange(g, towerById(await api.snapshot(), tower.id));
  const id = await spawnAt(api, { type: "atom", electrons: 3, pathId: 0, s });
  await api.call("setEnergy", 0);
  return { id, before: await api.snapshot() };
}

/**
 * A Dimer under a battery, so its pool AND both of the atoms it releases are stripped
 * before any of them reaches the collector.
 */
async function poseDimer(api, begin) {
  const snap = await begin(api, MAP.single);
  const g = pathGeom(snap.paths[0]);
  await battery(api, "cleaver", g, g.length * 0.2, g.length * 0.8, 4);
  const id = await spawnAt(api, { type: "dimer", pathId: 0, s: 0 });
  await api.call("setEnergy", 0);

  // The baseline is taken BEFORE the approach, not after it. Everything the run-in earns
  // belongs to this same unit and so belongs in the total; more importantly the INTEGRITY
  // in it has to predate the walk, or a build whose towers never engage would leak the
  // Dimer during the skip below and still satisfy "nothing leaked" against a baseline taken
  // after the leak had already happened.
  const before = await api.snapshot();

  // Walk it up to the first Cleaver INSTANTLY. A Dimer released at the inlet crosses a
  // fifth of the lane before anything can reach it, and that walk is not evidence of
  // anything — it is the journey to the evidence, and filmed in real time it was most of
  // the clip. `skipUntil` runs the same real simulation and films none of it.
  //
  // It stops as soon as a tower ACQUIRES the Dimer, which is before that tower's first shot
  // lands, so the clip still opens on a full bond pool and an untouched bank.
  await api.skipUntil((s) => s.towers.some((t) => t.targetId === id), {
    max: APPROACH_MAX_TICKS,
    poll: 6,
  });

  return { id, before };
}

export default function item() {
  let posedAtom;
  let atom;
  let dimer;

  return {
    id: "hitpoints.pays-total-shells",

    // Two framed payouts. The Dimer's is the headline number and it comes second, so a
    // budget that only covers the first scenario hides exactly the evidence the item exists
    // to produce.
    clipMs: clipBudget(2 * (LEAD_TICKS + TAIL_TICKS) + PAYOUT_TICKS + 120),

    async arrange(api) {
      posedAtom = await poseLoneAtom(api, startScenario);
    },

    // The atom being paid for shell by shell, then the Dimer's whole cascade being paid
    // for the same way.
    async act(api) {
      // The atom: an empty bank and a 3-electron atom, then three shells paid one at a
      // time as it is stripped, then the total it settled on.
      await api.advance(LEAD_TICKS);
      // poll 3 = the old 0.05 s chunk, for both sweeps.
      atom = await api.until((t) => unitById(t, posedAtom.id) == null, {
        max: MAX_CLEAR_TICKS,
        poll: 3,
      });
      await api.advance(TAIL_TICKS);

      // The Dimer: the same again over a whole cascade — the pool, then each of the two
      // atoms it releases — which is where the eleven comes from.
      const posedDimer = await poseDimer(api, poseScenario);
      await api.advance(LEAD_TICKS);
      dimer = {
        before: posedDimer.before,
        r: await api.until(
          (t) => unitById(t, posedDimer.id) == null && t.matter.length === 0,
          {
            max: MAX_CLEAR_TICKS,
            poll: 3,
          },
        ),
      };
      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectOk("the atom was neutralized", atom.hit);
      check.expectEq(
        "a 3-electron atom pays its 3 shells",
        atom.snap.energy - posedAtom.before.energy,
        ATOM3_TOTAL_SHELLS,
      );
      check.expectEq(
        "...and scores the same",
        atom.snap.score - posedAtom.before.score,
        ATOM3_TOTAL_SHELLS,
      );

      check.expectOk(
        "the cluster and every atom it released were cleared",
        dimer.r.hit,
      );
      check.expectEq(
        "nothing leaked (integrity intact)",
        dimer.r.snap.integrity,
        dimer.before.integrity,
      );
      check.expectEq(
        "a Dimer pays its 11 total shells (pool 5 + two atoms of 3)",
        dimer.r.snap.energy - dimer.before.energy,
        DIMER_TOTAL_SHELLS,
      );
      check.expectEq(
        "...and scores the same",
        dimer.r.snap.score - dimer.before.score,
        DIMER_TOTAL_SHELLS,
      );
    },
  };
}
