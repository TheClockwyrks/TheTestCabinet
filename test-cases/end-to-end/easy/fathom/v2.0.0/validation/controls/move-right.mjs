// controls.move-right: holding Right drives the forager right a corridor.
import { driveMoveKey, movedAlong, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.move-right");
  const { before, after } = await driveMoveKey(api, "ArrowRight", "right");
  check.expectEq("holding ArrowRight gives the forager a rightward heading", after.dir, "right");
  check.expectOk("holding ArrowRight moves the forager right a tile", movedAlong(before, after, "right"));
  await clip(api, 900);
  return check.verdict();
}
