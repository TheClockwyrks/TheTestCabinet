// Automated validation for the Building sub-item `place-stays-armed`.
//
// After placing a tower the shop stays armed with the same type, so a run of copies
// can be laid down in a row (specs/controls.md). We arm a tower, place it, and confirm
// it is built and still armed with the same type.

import { newGame, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("building.place-stays-armed");

  await newGame(api, "containment", "medium", 100000);
  await api.call("armTower", "arc");
  await api.call("movePreview", 10, 10);
  await api.call("place");
  const s = await api.snapshot();

  check.expectEq("the tower was built", s.towers.length, 1);
  check.expectOk("the shop is still armed after placing", s.build !== null);
  check.expectEq("still armed with the same type", s.build ? s.build.type : null, "arc");

  await liveClip(api, 1400);
  return check.verdict();
}
