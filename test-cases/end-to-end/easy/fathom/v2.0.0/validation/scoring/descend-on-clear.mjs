// scoring.descend-on-clear: clearing every plankton descends to a deeper trench.
import { startPlaying, stepTile, isOpen, wrapRow, DIR_KEY, clip } from "../_helpers.mjs";

function planktonDir(snap, f) {
  const wr = wrapRow(snap);
  for (const d of ["up", "down", "left", "right"]) {
    const [nc, nr] = stepTile(snap, f.tx, f.ty, d);
    const isWrap = nr === wr && (nc === 0 || nc === snap.grid.cols - 1);
    if (isOpen(snap.tiles, nc, nr) && !isWrap) return d;
  }
  return null;
}

export default async function drive(api, ttc) {
  const check = ttc.checkOne("scoring.descend-on-clear");
  const snap = await startPlaying(api);
  const depthBefore = snap.depth;
  await api.call("poseLastPlankton");
  const f = (await api.snapshot()).forager;
  const dir = planktonDir(snap, f);
  check.expectOk("a reachable last plankton was posed", dir !== null);
  if (!dir) return check.verdict();
  await api.call("keyDown", DIR_KEY[dir]);
  // Eat it (into the cleared interstitial), then let the interstitial run out.
  let s = await api.snapshot();
  for (let i = 0; i < 60 && s.screen === "playing"; i++) {
    await api.step(0.02);
    s = await api.snapshot();
  }
  await api.call("keyUp", DIR_KEY[dir]);
  check.expectEq("the trench is cleared", s.screen, "cleared");
  await api.step(2.0); // past the cleared interstitial → descend
  const after = await api.snapshot();
  check.expectEq("clearing descends to a deeper trench", after.depth, depthBefore + 1);
  await clip(api, 800);
  return check.verdict();
}
