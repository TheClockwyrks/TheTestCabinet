// Automated validation for color.worm-distinct: the worm renders in a color clearly
// distinct from the board background and from the node color.
//
// A worm segment and a node are posed and the rendered pixels sampled (api.pixel).
// The worm's color must stand apart from both an empty patch of board and the node.

import { colorDistance, freshBoard, sampleColor, setWorm, tileCX, tileCY } from "../_helpers.mjs";

const DISTINCT = 45;

export default async function drive(api, ttc) {
  const check = ttc.checkOne("color.worm-distinct");

  await freshBoard(api);
  await setWorm(api, [{ c: 10, r: 8 }, { c: 9, r: 8 }, { c: 8, r: 8 }], 1, 1);
  await api.call("setNode", 20, 8, 2);
  await api.wait(180);

  const worm = await sampleColor(api, tileCX(9), tileCY(8)); // a body segment
  const node = await sampleColor(api, tileCX(20), tileCY(8));
  const bg = await sampleColor(api, tileCX(30), tileCY(8)); // empty board

  check.expectGt("the worm is distinct from the board background", colorDistance(worm, bg), DISTINCT);
  check.expectGt("the worm is distinct from the node color", colorDistance(worm, node), DISTINCT);

  await api.screenshot("worm");

  return check.verdict();
}
