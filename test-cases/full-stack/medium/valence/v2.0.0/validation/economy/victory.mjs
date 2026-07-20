// Automated validation for the Economy sub-item `victory`.
//
// Clearing the final round of the campaign with integrity intact wins the game. The
// check opens a run on the final round (round 40, the lone Macromass), holds the opening
// stretch of the conduit with a battery of tier-III Impactor Cleavers, and runs the round
// out; when the boss and its whole fission chain are cracked down the round clears and
// the real campaign resolves to victory.
//
// The defence is what keeps the scenario SHORT. Round 40 left undefended is decided by
// the boss walking the entire conduit at 28 px/s — nearly two minutes of one unit
// crossing the board, which is no clip to make of a win. Cracking it at the inlet instead
// reaches the same resolution in about eighteen seconds of game time, and the game's own
// 3x speed control (a real control, and one the manual clock the verdict runs on ignores)
// brings that inside the record pass's filming budget, so the victory screen is actually
// reached and captured. Integrity stays huge throughout, so nothing here can resolve to
// anything but the win.

import {
  startRun,
  pathGeom,
  battery,
  MAP,
  HUGE_ENERGY,
  HUGE_INTEGRITY,
  TOTAL_ROUNDS,
} from "../_helpers.mjs";

const TOWERS = 24; // enough Impactors that the fission chain is cracked at the inlet
const FROM = 0.02; // the stretch of the conduit they hold, as a fraction of its length
const TO = 0.24;

export default function item() {
  let snap;

  return {
    id: "economy.victory",

    // ~18 s of game time at 3x is ~6 s of filming; the budget is set with room over that
    // so the capture is never what decides whether the screen is reached.
    clipMs: 12000,

    async arrange(api) {
      const run = await startRun(api, MAP.single, {
        round: TOTAL_ROUNDS,
        energy: HUGE_ENERGY,
        integrity: HUGE_INTEGRITY,
      });
      const g = pathGeom(run.paths[0]);
      const placed = await battery(
        api,
        "cleaver",
        g,
        g.length * FROM,
        g.length * TO,
        TOWERS,
      );
      for (const t of placed) {
        await api.call("upgradeTower", t.id); // -> tier II
        await api.call("upgradeTower", t.id, "B"); // -> tier III IMPACTOR (heavy specialist)
      }
      await api.call("setSpeed", 3);
      await api.call("startRound");
    },

    // The final round playing out to the campaign's resolution. 19200 ticks = the old
    // 320 s cap, far more than the round now needs; poll 120 = the old 2 s chunk.
    async act(api) {
      const r = await api.until(
        (s) => s.phase === "build" || s.screen !== "playing",
        { max: 19200, poll: 120 },
      );
      snap = r.snap;
      // A real pause so the victory screen has actually PAINTED before it is captured.
      await api.settle(200);
      await api.screenshot("victory");
    },

    async assert(api, check) {
      check.expectEq(
        "clearing the final round wins the game",
        snap.screen,
        "victory",
      );
    },
  };
}
