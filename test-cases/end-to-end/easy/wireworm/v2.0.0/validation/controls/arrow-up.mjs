// Automated validation for controls.arrow-up: holding the Up arrow moves the cursor
// up within the band. Injected input flows through the real key handling and
// moveCursor.

import { moveControlCheck } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.arrow-up");
  await moveControlCheck(api, check, { code: "ArrowUp", axis: "y", dir: -1, startX: 640, startY: 704 });
  return check.verdict();
}
