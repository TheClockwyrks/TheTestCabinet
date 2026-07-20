// Automated validation for controls.arrow-left: holding the Left arrow moves the
// cursor left. Injected input flows through the real key handling and moveCursor.

import { moveControlCheck } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.arrow-left");
  await moveControlCheck(api, check, { code: "ArrowLeft", axis: "x", dir: -1, startX: 1100, startY: 688 });
  return check.verdict();
}
