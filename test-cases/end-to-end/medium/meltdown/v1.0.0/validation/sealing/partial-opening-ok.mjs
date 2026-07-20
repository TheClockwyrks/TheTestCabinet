// Automated validation for the Sealing sub-item `partial-opening-ok`.
//
// A tower may partially cover a vent or exhaust opening — only fully sealing it is
// forbidden (specs/reactor.md). The left vent spans rows 16-19; a 2x2 tower at
// (0,16) covers rows 16-17 but leaves 18-19 open, so it is a valid placement.

import { newGame, build, tower } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("sealing.partial-opening-ok");

  await newGame(api, "containment", "medium", 100000);
  const can = await api.call("canPlace", "arc", 0, 16, 0);
  const id = await build(api, "arc", 0, 16);

  check.expectEq("partly covering the vent (rows 16-17) is a valid placement", can, true);
  check.expectOk("the partial-cover tower was built", (await tower(api, id)) !== null);
  check.expectOk("a route still exists past the partly-covered vent", isFinite((await api.snapshot()).paths.left.length));

  await api.wait(80);
  await api.screenshot("partial");
  return check.verdict();
}
