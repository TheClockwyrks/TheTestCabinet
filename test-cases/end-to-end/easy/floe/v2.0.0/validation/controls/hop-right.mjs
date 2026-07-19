// Automated validation for the Controls item `hop-right`.
//
// From an isolated safe pocket, one real press of the Right arrow hops the critter
// exactly one tile right (its column increases by one). See validation/_helpers.mjs.

import { hopControlCheck } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.hop-right");
  await hopControlCheck(api, check, {
    code: "ArrowRight",
    dcol: 1,
    drow: 0,
    who: "Right arrow",
  });
  return check.verdict();
}
