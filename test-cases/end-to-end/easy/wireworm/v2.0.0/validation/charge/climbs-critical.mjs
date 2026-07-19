// Automated validation for charge.climbs-critical: successive bumps raise a node
// 0->1->2->3 and cap at critical (3).
//
// Each rung is a fresh bump of a node at a chosen starting charge; the resulting
// charge is produced by the real stepWorm -> chargeNode and read back. The cap is
// checked by bumping a node already at 3: once critical the worm dives it (real
// path) and the charge stays 3.

import {
  chargeAt,
  freshBoard,
  head,
  liveClip,
  setWorm,
  straightWorm,
  wormStep,
} from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("charge.climbs-critical");

  // Each bump raises the node one level: 0->1, 1->2, 2->3.
  for (const start of [0, 1, 2]) {
    await freshBoard(api);
    await api.call("setNode", 20, 5, start);
    await setWorm(api, straightWorm(19, 5, 5, 1), 1, 1);
    const snap = await wormStep(api);
    check.expectEq(`a bump raises charge ${start} to ${start + 1}`, chargeAt(snap, 20, 5), start + 1);
  }

  // Cap: a node already at critical stays at 3 (the worm dives it instead).
  await freshBoard(api);
  await api.call("setNode", 20, 5, 3);
  await setWorm(api, straightWorm(19, 5, 5, 1), 1, 1);
  const capped = await wormStep(api);
  check.expectEq("charge caps at 3 (stays critical)", chargeAt(capped, 20, 5), 3);
  check.expectOk("the worm dives the critical node rather than charging it", head(capped).c === 19);

  // A live clip of a worm climbing a node to critical.
  await freshBoard(api);
  await api.call("setNode", 20, 5, 0);
  await setWorm(api, straightWorm(17, 5, 6, 1), 1, 1);
  await liveClip(api, 1600);

  return check.verdict();
}
