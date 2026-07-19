// controls.move-down: holding Down drives the forager down a corridor.
import { driveMoveKey, movedAlong, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.move-down");
  const { before, after } = await driveMoveKey(api, "ArrowDown", "down");
  check.expectEq("holding ArrowDown gives the forager a downward heading", after.dir, "down");
  check.expectOk("holding ArrowDown moves the forager down a tile", movedAlong(before, after, "down"));
  await clip(api, 900);
  return check.verdict();
}
