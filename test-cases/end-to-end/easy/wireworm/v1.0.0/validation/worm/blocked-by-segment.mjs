// Automated validation for worm.blocked-by-segment: blocked by a worm segment
// (rather than a node) the worm turns like any block, but charges nothing.
//
// The worm is posed in an L so a trailing segment sits directly ahead of its head;
// the head running into that segment routes through the real stepWorm segment-block
// path (segmentAt), which turns the worm without charging anything. The board stays
// empty of nodes.

import { freshBoard, liveClip, setWorm, wormStep } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("worm.blocked-by-segment");

  await freshBoard(api);
  // Head at (10,5) heading right; a trailing segment occupies (11,5) directly ahead.
  await setWorm(
    api,
    [
      { c: 10, r: 5 },
      { c: 9, r: 5 },
      { c: 9, r: 6 },
      { c: 10, r: 6 },
      { c: 11, r: 6 },
      { c: 11, r: 5 },
    ],
    1,
    1,
  );

  const before = (await api.snapshot()).worms[0];
  check.expectEq("the worm starts heading right", before.dh, 1);

  const snap = await wormStep(api);
  check.expectEq("blocked by a segment, the worm reverses its heading", snap.worms[0].dh, -1);
  check.expectEq("turning at a segment charges nothing (no node created)", snap.nodes.length, 0);

  await liveClip(api, 1200);

  return check.verdict();
}
