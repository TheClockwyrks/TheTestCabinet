// Automated validation for the Rocks item `split-large`: destroying a Large rock yields
// two Medium rocks. A single Large is posed on an empty field and shot until destroyed
// (one bullet in the base game, or however many its armor takes in Warhead); the field
// is then read for the two Medium fragments.

import { poseAndDestroy, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("rocks.split-large");

  const { snap } = await poseAndDestroy(api, "large");
  const mediums = snap.rocks.filter((r) => r.size === "medium");
  const larges = snap.rocks.filter((r) => r.size === "large");

  check.expectEq("the Large rock is gone once destroyed", larges.length, 0);
  check.expectEq("a destroyed Large yields exactly two Medium rocks", mediums.length, 2);

  await liveClip(api, 700);
  return check.verdict();
}
