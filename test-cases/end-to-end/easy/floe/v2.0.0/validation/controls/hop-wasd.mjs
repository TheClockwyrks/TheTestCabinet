// Automated validation for the Controls item `hop-wasd`.
//
// W/A/S/D each hop the critter in the matching direction, the same as the arrow
// keys. Each key is tested from a fresh safe pocket: one real press, then the
// snapshot confirms the critter moved one tile the right way. See _helpers.mjs.

import { hopPocket, ICE_TOP } from "../_helpers.mjs";

const CASES = [
  { code: "KeyW", dcol: 0, drow: -1, who: "W hops up" },
  { code: "KeyA", dcol: -1, drow: 0, who: "A hops left" },
  { code: "KeyS", dcol: 0, drow: 1, who: "S hops down" },
  { code: "KeyD", dcol: 1, drow: 0, who: "D hops right" },
];

export default function item() {
  // The critter either side of each key's press, for `assert` to compare.
  let results;

  return {
    id: "controls.hop-wasd",

    // Pose the safe pocket once: the top two ice lanes cleared and the critter on the
    // top ice row, so every direction lands on a solid, hazard-free tile.
    async arrange(api) {
      await hopPocket(api);
    },

    // Each key in turn, re-centering the critter in the pocket between them. The
    // re-pose is `placeCritter` alone rather than another `hopPocket` — that helper
    // leads with `startCrossing`, whose reset would take the clock back mid-`act` and
    // freeze the recording. The cleared lanes it set survive, so a re-place restores
    // the pocket exactly.
    async act(api) {
      results = [];
      for (const c of CASES) {
        await api.call("placeCritter", 20, ICE_TOP);
        const before = (await api.snapshot()).critter;
        await api.call("press", c.code);
        await api.advance(18); // 0.15 s, just past the hop cooldown, so the hop lands
        const after = (await api.snapshot()).critter;
        results.push({ c, before, after });
      }
    },

    async assert(api, check) {
      for (const { c, before, after } of results) {
        check.expectEq(`${c.who} (column)`, after.col, before.col + c.dcol);
        check.expectEq(`${c.who} (row)`, after.row, before.row + c.drow);
      }
    },
  };
}
