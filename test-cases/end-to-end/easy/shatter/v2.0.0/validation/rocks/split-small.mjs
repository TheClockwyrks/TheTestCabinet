// Automated validation for the Rocks item `split-small`: a Small rock is destroyed
// outright, leaving no fragment. A single Small is posed on an empty field and shot
// until destroyed; the field must then be empty.

import { poseAndDestroy, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("rocks.split-small");

  const { snap } = await poseAndDestroy(api, "small");

  check.expectEq("a destroyed Small leaves no fragments — the field is empty", snap.rocks.length, 0);

  await liveClip(api, 600);
  return check.verdict();
}
