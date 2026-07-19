// Automated validation for charge.critical-dive: a worm blocked by a critical node
// dives straight down its own column instead of the normal drop-and-reverse.
//
// A critical node with a worm heading into it are the preconditions; the dive is
// produced by the real stepWorm critical-node branch. The worm's head holds its
// column and its row keeps increasing as it plunges.

import {
  freshBoard,
  head,
  liveClip,
  setWorm,
  straightWorm,
  wormStep,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("charge.critical-dive");

  await freshBoard(api);
  await api.call("setNode", 20, 5, 3); // a critical node
  await setWorm(api, straightWorm(19, 5, 5, 1), 1, 1); // head heading into it
  await api.call("setCursor", 100, 700); // out of the dive column

  const s1 = await wormStep(api);
  const h1 = head(s1);
  check.expectOk("the worm enters a dive at the critical node", s1.worms[0].diving);
  check.expectEq("the dive holds the head's column", h1.c, 19);
  check.expectGt("the head drops a row on the first dive step", h1.r, 5);

  // Keep diving: the column stays fixed and the row keeps increasing.
  const s2 = await wormStep(api);
  const s3 = await wormStep(api);
  check.expectEq("the column stays fixed while diving", head(s3).c, 19);
  check.expectGt("the row keeps increasing while diving", head(s3).r, head(s2).r);

  // A live clip of the worm diving a critical column.
  await freshBoard(api);
  await api.call("setNode", 20, 5, 3);
  await setWorm(api, straightWorm(19, 5, 6, 1), 1, 1);
  await api.call("setCursor", 100, 700);
  await liveClip(api, 1400);

  return check.verdict();
}
