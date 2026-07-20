// Automated validation for controls.wasd-d: holding the D key moves the cursor right.
// Injected input flows through the real key handling and moveCursor.

import { moveControlCheck } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.wasd-d");
  await moveControlCheck(api, check, { code: "KeyD", axis: "x", dir: 1, startX: 180, startY: 688 });
  return check.verdict();
}
