// controls.move-up: holding Up drives the forager up a corridor.
import { driveMoveKey, movedAlong, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.move-up");
  const { before, after } = await driveMoveKey(api, "ArrowUp", "up");
  check.expectEq("holding ArrowUp gives the forager an upward heading", after.dir, "up");
  check.expectOk("holding ArrowUp moves the forager up a tile", movedAlong(before, after, "up"));
  await clip(api, 900);
  return check.verdict();
}
