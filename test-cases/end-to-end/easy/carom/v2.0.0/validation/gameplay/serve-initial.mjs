// Automated validation for the Gameplay sub-item `serve-initial`.
//
// The very first serve of every match always travels toward player one (vx < 0),
// whichever player would otherwise be the receiver. Two fresh matches are started
// and each first serve's horizontal direction is read back. base and gyre both serve
// toward the receiver and drive this same shared script; multi (random-angle
// launches) declares no such point. See validation/_helpers.mjs.

import { firstServeVx } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("gameplay.serve-initial");

  const first1 = await firstServeVx(api);
  const first2 = await firstServeVx(api);
  check.expectLt(
    "the very first serve of a match travels toward player one (vx)",
    first1,
    0,
  );
  check.expectLt(
    "a second fresh match's first serve also travels toward player one (vx)",
    first2,
    0,
  );

  // A clip: the fresh first serve travelling toward player one (leftward). Hand the
  // clock back to the animation loop so the served ball actually moves in the clip.
  await api.call("setAutoStep", true);
  await api.wait(1000);

  return check.verdict();
}
