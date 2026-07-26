// Automated validation for the Rotation sub-item `aims-faces`.
//
// Rotating a tower 90 degrees turns its radiator faces (specs/heat.md, towers.md).
// We place the same emitter type at two rotations and read its world radiator faces
// back — the Arc's radiators are on N/S un-rotated and rotate to E/W at one quarter
// turn.

import { newGame, build, tower } from "../_helpers.mjs";

export default function item() {
  let aId;
  let bId;
  let fa;
  let fb;

  return {
    id: "rotation.aims-faces",

    // The same tower type at two rotations, side by side, so the only difference
    // between the two readings is the quarter turn.
    async arrange(api) {
      await newGame(api, "containment", "medium", 100000);
      aId = await build(api, "arc", 10, 10, 0);
      bId = await build(api, "arc", 14, 10, 1);
    },

    // Read the world radiator faces each placement reports, then let a frame land so
    // the still shows both towers' fins pointing different ways.
    async act(api) {
      fa = (await tower(api, aId)).radiatorFaces;
      fb = (await tower(api, bId)).radiatorFaces;
      await api.settle(80);
      await api.screenshot("faces");
    },

    async assert(api, check) {
      check.expectOk(
        "un-rotated radiators point N and S",
        fa.includes("N") && fa.includes("S"),
      );
      check.expectOk(
        "a quarter turn points them E and W",
        fb.includes("E") && fb.includes("W"),
      );
      check.expectEq(
        "rotation does not add or drop faces",
        fb.length,
        fa.length,
      );
    },
  };
}
