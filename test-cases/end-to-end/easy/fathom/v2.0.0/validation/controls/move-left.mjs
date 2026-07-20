// controls.move-left: holding Left drives the forager left a corridor.
import { driveMoveKey, movedAlong, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("controls.move-left");
  const { before, after } = await driveMoveKey(api, "ArrowLeft", "left");
  check.expectEq("holding ArrowLeft gives the forager a leftward heading", after.dir, "left");
  check.expectOk("holding ArrowLeft moves the forager left a tile", movedAlong(before, after, "left"));
  await clip(api, 900);
  return check.verdict();
}
