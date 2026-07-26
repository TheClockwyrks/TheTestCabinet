// Automated validation for the Boss sub-item `milestone-rounds`.
//
// The campaign fields exactly one Macromass, and Round 40 is it: a single unit, and the
// whole of that round. No other round folds one in — including the round numbers a
// milestone ladder would put one on (10, 20, 30), which are ordinary rounds of ordinary
// matter. The check starts each of those rounds and runs through its whole release span,
// watching the real matter list.
//
// FIVE runs. Only the first can be arranged (it opens from a seeded reset); the rest are
// posed inside `act` with `poseRun`, which reaches the same fresh run using control ops
// alone — `api.reset` throws in `act`, because it would take the clock back and freeze
// the recording.

import { startRun, poseRun, TOTAL_ROUNDS, MAP } from "../_helpers.mjs";

const ORDINARY_ROUNDS = [9, 10, 20, 30];
// Generous: every round's release span is under 30 s of game time (specs/matter.md), and
// this is game time, not wall clock. 5400 ticks = the old 90 s cap.
const MAX_WAVE_TICKS = 5400;

/** Open a run primed at `round` and start it; `begin` is `startRun` or `poseRun`. */
async function poseRelease(api, begin, round) {
  await begin(api, MAP.single, { round, integrity: 1e9 });
  await api.call("startRound");
}

// Run through a started round's release, returning whether a Macromass was ever released
// and how many distinct units the round put on the board.
async function actRelease(api) {
  const ids = new Set();
  let sawBoss = false;
  await api.until(
    (s) => {
      for (const u of s.matter) {
        ids.add(u.id);
        if (u.type === "macromass") sawBoss = true;
      }
      return false; // sweep the whole span; the boss group is released last
    },
    // poll 30 = the old 0.5 s chunk.
    { max: MAX_WAVE_TICKS, poll: 30 },
  );
  return { sawBoss, units: ids.size };
}

export default function item() {
  let final;
  let ordinary;

  return {
    id: "boss.milestone-rounds",

    // Round 40 — the boss round — is the run this item arranges.
    async arrange(api) {
      await poseRelease(api, startRun, TOTAL_ROUNDS);
      ordinary = new Map();
    },

    // The boss round's release first (the thing the item is named for, and so the part of
    // the clip worth seeing), then each ordinary round in turn.
    async act(api) {
      final = await actRelease(api);

      for (const round of ORDINARY_ROUNDS) {
        await poseRelease(api, poseRun, round);
        ordinary.set(round, await actRelease(api));
      }
    },

    async assert(api, check) {
      check.expectOk(`round ${TOTAL_ROUNDS} fields the boss`, final.sawBoss);
      check.expectEq(
        `round ${TOTAL_ROUNDS} is the boss alone — one unit, and the whole round`,
        final.units,
        1,
      );

      for (const round of ORDINARY_ROUNDS) {
        const seen = ordinary.get(round);
        check.expectOk(
          `round ${round} is an ordinary round with no boss`,
          seen.sawBoss === false,
        );
        check.expectGt(
          `round ${round} does release matter (the sweep really ran)`,
          seen.units,
          0,
        );
      }
    },
  };
}
