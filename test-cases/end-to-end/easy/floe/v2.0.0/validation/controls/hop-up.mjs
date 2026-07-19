// Automated validation for the Controls item `hop-up`.
//
// From an isolated safe pocket, one real press of the Up arrow hops the critter
// exactly one tile up (its row decreases by one) through the game's own play code,
// which the snapshot reads back. See validation/_helpers.mjs.

import { hopControlCheck } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.hop-up");
  await hopControlCheck(api, check, {
    code: "ArrowUp",
    dcol: 0,
    drow: -1,
    who: "Up arrow",
  });
  return check.verdict();
}
