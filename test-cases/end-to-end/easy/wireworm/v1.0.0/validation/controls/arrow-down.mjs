// Automated validation for controls.arrow-down: holding the Down arrow moves the
// cursor down within the band. Injected input flows through the real key handling and
// moveCursor.

import { moveControlCheck } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.arrow-down");
  await moveControlCheck(api, check, { code: "ArrowDown", axis: "y", dir: 1, startX: 640, startY: 672 });
  return check.verdict();
}
