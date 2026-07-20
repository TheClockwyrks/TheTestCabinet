// Automated validation for controls.arrow-right: holding the Right arrow moves the
// cursor right. Injected input flows through the real key handling and moveCursor.

import { moveControlCheck } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.arrow-right");
  await moveControlCheck(api, check, { code: "ArrowRight", axis: "x", dir: 1, startX: 180, startY: 688 });
  return check.verdict();
}
