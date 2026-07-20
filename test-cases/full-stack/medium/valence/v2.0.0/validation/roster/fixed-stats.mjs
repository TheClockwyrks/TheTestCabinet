// Automated validation for the Roster sub-item `fixed-stats`.
//
// Every matter type is the same unit in every round. Its shells, bond pool, speed, and
// leak value are fixed by the roster and never scale with the round number: a Dimer in
// Round 20 is the identical unit to a Dimer in Round 38. Difficulty lives entirely in the
// round table — in what a row sends and how much of it — so nothing about a unit may
// change underneath the player between one round and a later one.
//
// The check reads units the REAL wave system released, not posed ones, so it is the round
// pipeline being checked and not just the roster table: it starts an early and a late
// round that both field the same type and compares the first unit of that type each one
// puts on the board. The absolute values are pinned too, so a build that scaled every
// round equally could not pass by being merely self-consistent.
//
// FOUR runs. Only the first is arranged; the rest are posed inside `act` with `poseRun`,
// since `api.reset` throws there.

import { startRun, poseRun, MAP } from "../_helpers.mjs";

const MAX_WAVE_TICKS = 5400; // 5400 ticks = the old 90 s cap — game time, not wall clock

// The roster's fixed stats for the two types compared (specs/matter.md).
const DIMER = { maxBond: 5, baseSpeed: 50 };
const ISOTOPE = { maxHp: 9, baseSpeed: 36 };

/** Open a run primed at `round` and start it; `begin` is `startRun` or `poseRun`. */
async function poseRound(api, begin, round) {
  await begin(api, MAP.single, { round, integrity: 1e9 });
  await api.call("startRound");
}

/** Run a started round until the real wave system releases a unit of `type`. */
async function actFirstOfType(api, type) {
  let found = null;
  // poll 3 = the old 0.05 s chunk.
  await api.until(
    (s) => {
      const u = s.matter.find((m) => m.type === type);
      if (u && found == null) found = u;
      return found != null;
    },
    { max: MAX_WAVE_TICKS, poll: 3 },
  );
  return found;
}

export default function item() {
  let earlyDimer;
  let lateDimer;
  let earlyIsotope;
  let lateIsotope;

  return {
    id: "roster.fixed-stats",

    // Dimers arrive first in Round 20; that is the run this item arranges.
    async arrange(api) {
      await poseRound(api, startRun, 20);
    },

    // Each round's release in turn, so the clip opens on the early Dimer wave the later
    // ones are compared against.
    async act(api) {
      earlyDimer = await actFirstOfType(api, "dimer");

      // ...and again in Round 38, eighteen rounds later.
      await poseRound(api, poseRun, 38);
      lateDimer = await actFirstOfType(api, "dimer");

      // Isotopes arrive in Round 26 and again in Round 39.
      await poseRound(api, poseRun, 26);
      earlyIsotope = await actFirstOfType(api, "isotope");

      await poseRound(api, poseRun, 39);
      lateIsotope = await actFirstOfType(api, "isotope");
    },

    async assert(api, check) {
      check.expectOk(
        "an early round released a Dimer to compare",
        earlyDimer != null,
      );
      check.expectOk(
        "a late round released a Dimer to compare",
        lateDimer != null,
      );
      check.expectEq(
        "an early Dimer's bond pool is the roster's 5",
        earlyDimer.maxBond,
        DIMER.maxBond,
      );
      check.expectEq(
        "a late Dimer's bond pool is unchanged",
        lateDimer.maxBond,
        DIMER.maxBond,
      );
      check.expectEq(
        "an early Dimer's speed is the roster's 50",
        earlyDimer.baseSpeed,
        DIMER.baseSpeed,
      );
      check.expectEq(
        "a late Dimer's speed is unchanged",
        lateDimer.baseSpeed,
        DIMER.baseSpeed,
      );

      check.expectOk(
        "an early round released an Isotope to compare",
        earlyIsotope != null,
      );
      check.expectOk(
        "a late round released an Isotope to compare",
        lateIsotope != null,
      );
      check.expectEq(
        "an early Isotope carries the roster's 9 shells",
        earlyIsotope.maxHp,
        ISOTOPE.maxHp,
      );
      check.expectEq(
        "a late Isotope carries the same 9 shells",
        lateIsotope.maxHp,
        ISOTOPE.maxHp,
      );
      check.expectEq(
        "an early Isotope's speed is the roster's 36",
        earlyIsotope.baseSpeed,
        ISOTOPE.baseSpeed,
      );
      check.expectEq(
        "a late Isotope's speed is unchanged",
        lateIsotope.baseSpeed,
        ISOTOPE.baseSpeed,
      );
    },
  };
}
