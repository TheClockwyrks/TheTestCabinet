// Automated validation for the Controls item `hop-down`.
//
// From an isolated safe pocket, one real press of the Down arrow hops the critter
// exactly one tile down (its row increases by one). See validation/_helpers.mjs.

import { hopControlCheck } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.hop-down");
  await hopControlCheck(api, check, {
    code: "ArrowDown",
    dcol: 0,
    drow: 1,
    who: "Down arrow",
  });
  return check.verdict();
}
