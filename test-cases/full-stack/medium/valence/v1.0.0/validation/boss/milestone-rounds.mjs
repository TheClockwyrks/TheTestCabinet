// Automated validation for the Boss sub-item `milestone-rounds`.
//
// The campaign fields exactly one Macromass, and Round 40 is it: a single unit, and the
// whole of that round. No other round folds one in — including the round numbers a
// milestone ladder would put one on (10, 20, 30), which are ordinary rounds of ordinary
// matter. The check starts each of those rounds and steps through its whole release span
// on the manual clock, watching the real matter list.

import { startRun, stepUntil, liveClip, TOTAL_ROUNDS, MAP } from "../_helpers.mjs";

const ORDINARY_ROUNDS = [9, 10, 20, 30];
// Generous: every round's release span is under 30 s of game time (specs/matter.md), and
// this is game time on the manual clock, not wall clock.
const MAX_WAVE_SECONDS = 90;

// Start `round` and step through its release, returning whether a Macromass was ever
// released and how many distinct units the round put on the board.
async function releaseOf(api, round) {
  await startRun(api, MAP.single, { round, integrity: 1e9 });
  await api.call("startRound");
  const ids = new Set();
  let sawBoss = false;
  await stepUntil(
    api,
    (s) => {
      for (const u of s.matter) {
        ids.add(u.id);
        if (u.type === "macromass") sawBoss = true;
      }
      return false; // sweep the whole span; the boss group is released last
    },
    MAX_WAVE_SECONDS,
    0.5,
  );
  return { sawBoss, units: ids.size };
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("boss.milestone-rounds");

  const final = await releaseOf(api, TOTAL_ROUNDS);
  check.expectOk(`round ${TOTAL_ROUNDS} fields the boss`, final.sawBoss);
  check.expectEq(`round ${TOTAL_ROUNDS} is the boss alone — one unit, and the whole round`, final.units, 1);

  for (const round of ORDINARY_ROUNDS) {
    const ordinary = await releaseOf(api, round);
    check.expectOk(`round ${round} is an ordinary round with no boss`, ordinary.sawBoss === false);
    check.expectGt(`round ${round} does release matter (the sweep really ran)`, ordinary.units, 0);
  }

  await liveClip(api, 800);
  return check.verdict();
}
