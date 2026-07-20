// Automated validation for the Controls item `hop-left`.
//
// From an isolated safe pocket, one real press of the Left arrow hops the critter
// exactly one tile left (its column decreases by one). See validation/_helpers.mjs.

import { hopControlCheck } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.hop-left");
  await hopControlCheck(api, check, {
    code: "ArrowLeft",
    dcol: -1,
    drow: 0,
    who: "Left arrow",
  });
  return check.verdict();
}
