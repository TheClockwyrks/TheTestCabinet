// Automated validation for controls.fire-space: pressing Space fires a bolt straight
// up from the cursor. Injected input flows through the real key handling and the real
// updateFiring, and a bolt appears.

import { freshBoard, tileCX } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.fire-space");

  await freshBoard(api);
  await api.call("setCursor", tileCX(20), 688);
  check.expectEq("no bolt before firing", (await api.snapshot()).bolts.length, 0);
  await api.call("keyDown", "Space");
  await api.step(0.05);
  check.expectGe("pressing Space fires a bolt", (await api.snapshot()).bolts.length, 1);
  await api.call("keyUp", "Space");

  // A live clip of firing with Space.
  await freshBoard(api);
  await api.call("setCursor", tileCX(20), 688);
  await api.call("setAutoStep", true);
  await api.call("keyDown", "Space");
  await api.wait(800);
  await api.call("keyUp", "Space");

  return check.verdict();
}
