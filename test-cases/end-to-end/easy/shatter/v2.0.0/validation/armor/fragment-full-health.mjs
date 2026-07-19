// Automated validation (Warhead) for the Armor item `fragment-full-health`: rocks created
// by a split enter at full health for their size. A Large is destroyed with the primary gun;
// the two Medium fragments must each carry full Medium health (2), not the parent's chipped
// value.

import { poseAndDestroy, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("armor.fragment-full-health");

  const { snap } = await poseAndDestroy(api, "large");
  const mediums = snap.rocks.filter((r) => r.size === "medium");

  check.expectEq("the destroyed Large yields two Medium fragments", mediums.length, 2);
  if (mediums.length === 2) {
    check.expectEq("the first fragment enters at full Medium health (2)", mediums[0].health, 2);
    check.expectEq("the second fragment enters at full Medium health (2)", mediums[1].health, 2);
  }

  await liveClip(api, 700);
  return check.verdict();
}
