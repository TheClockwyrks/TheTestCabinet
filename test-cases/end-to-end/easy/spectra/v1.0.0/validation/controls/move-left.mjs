// Automated validation for the Controls sub-item `move-left`.
//
// Holding Left (or A) moves the ship left. The match is entered and the key held
// through injected input; the real ship update, stepped forward, moves it, and the
// displacement is read back. Both bindings are checked.

import { startClean, holdMoveX, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.move-left");

  await startClean(api);
  await api.call("setShipX", 640);
  const arrow = await holdMoveX(api, "ArrowLeft");
  check.expectLt("holding ArrowLeft moves the ship left", arrow.dx, -50);

  await startClean(api);
  await api.call("setShipX", 640);
  const a = await holdMoveX(api, "KeyA");
  check.expectLt("holding A moves the ship left", a.dx, -50);

  // A live clip of the ship sliding left.
  await startClean(api);
  await api.call("setShipX", 900);
  await api.call("keyDown", "ArrowLeft");
  await clip(api, 900);
  await api.call("keyUp", "ArrowLeft");
  return check.verdict();
}
