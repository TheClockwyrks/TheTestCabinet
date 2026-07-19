// maze-movement.turn-at-center: a buffered perpendicular turn is taken at the tile
// center, not mid-tile.
import { startPlaying, findCorner, DIR_KEY, clip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("maze-movement.turn-at-center");
  const snap = await startPlaying(api);
  const c = findCorner(snap);
  // Approach the junction from the tile behind it.
  await api.call("setForager", { tx: c.back.tx, ty: c.back.ty });
  await api.call("keyDown", DIR_KEY[c.approach]);
  await api.step(0.12); // ~15 px in: mid-tile, short of the junction center
  // Buffer the perpendicular turn while mid-tile.
  await api.call("keyDown", DIR_KEY[c.perp]);
  const mid = (await api.snapshot()).forager;
  check.expectEq(
    "the buffered turn is NOT taken mid-tile (still on the approach heading)",
    mid.dir,
    c.approach,
  );
  await api.step(0.3); // reach the junction center — the turn is taken there
  const turned = (await api.snapshot()).forager;
  await api.call("keyUp", DIR_KEY[c.approach]);
  await api.call("keyUp", DIR_KEY[c.perp]);
  check.expectEq("the turn onto the perpendicular arm is taken", turned.dir, c.perp);
  const at = `${turned.tx},${turned.ty}`;
  const ok =
    at === `${c.junction.tx},${c.junction.ty}` ||
    at === `${c.perpTile.tx},${c.perpTile.ty}`;
  check.expectOk("the turn was taken at the junction center, not earlier", ok);
  await clip(api, 800);
  return check.verdict();
}
