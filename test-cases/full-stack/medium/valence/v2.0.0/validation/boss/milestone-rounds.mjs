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

import {
  startRun,
  poseRun,
  clipBudget,
  TOTAL_ROUNDS,
  MAP,
} from "../_helpers.mjs";

// HOW THE FIVE ROUNDS ARE PACED.
//
// The verdict sweeps each round's WHOLE release span — that is the only way to say "no boss
// was folded in anywhere" — but five spans of up to 90 s of game time is nowhere near a
// recording. Filmed straight through, the record pass spent its entire budget inside round
// 40 and the four ordinary rounds never appeared, so the clip showed the boss and nothing
// to contrast it against.
//
// So each round is filmed briefly and swept instantly. Round 40 gets the longer window,
// because the boss arriving is the thing the item is named for; the ordinary rounds get a
// shorter one at 3x game speed, which is enough to see ordinary matter streaming out of the
// inlet and no Macromass among it.
//
// The SPEED is safe to pose here only because it cannot reach the verdict: `setSpeed`
// scales how much game time a real-time `advance` covers in the record pass and does
// nothing at all in the validate pass (see the note in `_helpers.mjs`), and every id this
// item counts is gathered by the instant sweep that follows, which is identical in both.
const BOSS_SHOW_TICKS = 240;
const ORDINARY_SHOW_TICKS = 150;
const ORDINARY_SPEED = 3;

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
async function actRelease(api, { show }) {
  const ids = new Set();
  let sawBoss = false;
  const collect = (s) => {
    for (const u of s.matter) {
      ids.add(u.id);
      if (u.type === "macromass") sawBoss = true;
    }
    return false; // never stop early; the boss group would be released last
  };

  // The filmed sample — real time, and collecting as it goes.
  await api.until(collect, { max: show, poll: 6 });
  // The rest of the span, swept instantly. poll 30 = the old 0.5 s chunk.
  await api.skipUntil(collect, { max: MAX_WAVE_TICKS, poll: 30 });

  return { sawBoss, units: ids.size };
}

export default function item() {
  let final;
  let ordinary;

  return {
    id: "boss.milestone-rounds",

    clipMs: clipBudget(
      BOSS_SHOW_TICKS + ORDINARY_ROUNDS.length * ORDINARY_SHOW_TICKS,
    ),

    // Round 40 — the boss round — is the run this item arranges.
    async arrange(api) {
      await poseRelease(api, startRun, TOTAL_ROUNDS);
      ordinary = new Map();
    },

    // The boss round's release first (the thing the item is named for, and so the part of
    // the clip worth seeing), then each ordinary round in turn.
    async act(api) {
      final = await actRelease(api, { show: BOSS_SHOW_TICKS });

      // The ordinary rounds, fast-forwarded: same sweep, less of the reviewer's time.
      await api.call("setSpeed", ORDINARY_SPEED);
      for (const round of ORDINARY_ROUNDS) {
        await poseRelease(api, poseRun, round);
        ordinary.set(
          round,
          await actRelease(api, { show: ORDINARY_SHOW_TICKS }),
        );
      }
      await api.call("setSpeed", 1);
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
