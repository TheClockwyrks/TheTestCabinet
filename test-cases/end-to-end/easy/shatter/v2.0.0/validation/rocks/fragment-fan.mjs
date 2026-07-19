// Automated validation for the Rocks item `fragment-fan`: split fragments fan apart to
// opposite sides based on the shot direction and inherit the parent's motion. A Large
// rock drifting LEFTWARD (against the star's rightward pull) is destroyed with a
// horizontal shot; the two fragments must fan to opposite vertical sides and both keep
// the parent's leftward drift (which gravity alone could not produce).

import { poseAndDestroy, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("rocks.fragment-fan");

  // Parent drifts left; the shot is horizontal, so the split kick is vertical.
  const { snap } = await poseAndDestroy(api, "large", { x: 520, y: 250, vx: -80, vy: 0 });
  const frags = snap.rocks.filter((r) => r.size === "medium");

  check.expectEq("the Large split into two fragments", frags.length, 2);
  if (frags.length === 2) {
    check.expectLt(
      "the fragments fan to opposite vertical sides of the shot",
      frags[0].vy * frags[1].vy,
      0,
    );
    check.expectGt("one fragment kicks well off-axis", Math.abs(frags[0].vy), 40);
    check.expectGt("the other fragment kicks the opposite way", Math.abs(frags[1].vy), 40);
    check.expectLt("both fragments inherit the parent's leftward drift", frags[0].vx, -20);
    check.expectLt("both fragments inherit the parent's leftward drift", frags[1].vx, -20);
  }

  await liveClip(api, 700);
  return check.verdict();
}
