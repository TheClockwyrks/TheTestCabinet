// Automated validation for controls.wasd-w: holding the W key moves the cursor up
// within the band. Injected input flows through the real key handling and moveCursor.

import { moveControlCheck } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.wasd-w");
  await moveControlCheck(api, check, { code: "KeyW", axis: "y", dir: -1, startX: 640, startY: 704 });
  return check.verdict();
}
