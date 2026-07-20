// Automated validation for the Controls sub-item `move-right`.
//
// Holding Right (or D) moves the ship right. The key is held through injected input
// and the real ship update stepped forward; the displacement is read back. Both
// bindings are checked.

import { startClean, holdMoveX, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.move-right");

  await startClean(api);
  await api.call("setShipX", 640);
  const arrow = await holdMoveX(api, "ArrowRight");
  check.expectGt("holding ArrowRight moves the ship right", arrow.dx, 50);

  await startClean(api);
  await api.call("setShipX", 640);
  const d = await holdMoveX(api, "KeyD");
  check.expectGt("holding D moves the ship right", d.dx, 50);

  // A live clip of the ship sliding right.
  await startClean(api);
  await api.call("setShipX", 400);
  await api.call("keyDown", "ArrowRight");
  await clip(api, 900);
  await api.call("keyUp", "ArrowRight");
  return check.verdict();
}
