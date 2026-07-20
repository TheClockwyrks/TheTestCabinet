// Automated validation for the Rotation sub-item `aims-faces`.
//
// Rotating a tower 90 degrees turns its radiator faces (specs/heat.md, towers.md).
// We place the same emitter type at two rotations and read its world radiator faces
// back — the Arc's radiators are on N/S un-rotated and rotate to E/W at one quarter
// turn.

import { newGame, build, tower } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("rotation.aims-faces");

  await newGame(api, "containment", "medium", 100000);
  const a = await build(api, "arc", 10, 10, 0);
  const b = await build(api, "arc", 14, 10, 1);

  const fa = (await tower(api, a)).radiatorFaces;
  const fb = (await tower(api, b)).radiatorFaces;

  check.expectOk("un-rotated radiators point N and S", fa.includes("N") && fa.includes("S"));
  check.expectOk("a quarter turn points them E and W", fb.includes("E") && fb.includes("W"));
  check.expectEq("rotation does not add or drop faces", fb.length, fa.length);

  await api.wait(80);
  await api.screenshot("faces");
  return check.verdict();
}
