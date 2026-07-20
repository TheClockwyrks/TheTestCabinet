// Automated validation for the Controls item `hop-wasd`.
//
// W/A/S/D each hop the critter in the matching direction, the same as the arrow
// keys. Each key is tested from a fresh safe pocket: one real press, then the
// snapshot confirms the critter moved one tile the right way. See _helpers.mjs.

import { hopPocket } from "../_helpers.mjs";

const CASES = [
  { code: "KeyW", dcol: 0, drow: -1, who: "W hops up" },
  { code: "KeyA", dcol: -1, drow: 0, who: "A hops left" },
  { code: "KeyS", dcol: 0, drow: 1, who: "S hops down" },
  { code: "KeyD", dcol: 1, drow: 0, who: "D hops right" },
];

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.hop-wasd");

  for (const c of CASES) {
    await hopPocket(api);
    const before = (await api.snapshot()).critter;
    await api.call("press", c.code);
    await api.step(0.15);
    const after = (await api.snapshot()).critter;
    check.expectEq(`${c.who} (column)`, after.col, before.col + c.dcol);
    check.expectEq(`${c.who} (row)`, after.row, before.row + c.drow);
  }

  // Clip: a quick WASD tour in real time.
  await hopPocket(api);
  await api.call("setAutoStep", true);
  await api.wait(200);
  for (const c of ["KeyW", "KeyA", "KeyS", "KeyD"]) {
    await api.call("press", c);
    await api.wait(220);
  }

  return check.verdict();
}
