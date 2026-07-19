// Automated validation for the Controls sub-item `rotate`.
//
// R rotates the held preview 90 degrees before placing (specs/controls.md). We arm a
// tower, then press R and read the held rotation advance.

import { newGame, press } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.rotate");

  await newGame(api, "containment", "medium", 100000);
  await press(api, "Digit1"); // arm the Arc
  check.expectEq("the held tower starts un-rotated", (await api.snapshot()).build.rotation, 0);
  await press(api, "KeyR");
  check.expectEq("R rotates the held tower a quarter turn", (await api.snapshot()).build.rotation, 1);

  await api.call("setAutoStep", true);
  await api.wait(1400);
  return check.verdict();
}
