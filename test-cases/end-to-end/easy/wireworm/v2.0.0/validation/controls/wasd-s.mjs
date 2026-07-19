// Automated validation for controls.wasd-s: holding the S key moves the cursor down
// within the band. Injected input flows through the real key handling and moveCursor.

import { moveControlCheck } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.wasd-s");
  await moveControlCheck(api, check, { code: "KeyS", axis: "y", dir: 1, startX: 640, startY: 672 });
  return check.verdict();
}
