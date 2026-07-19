// states.cleared: clearing a trench shows the cleared interstitial.
import { startPlaying, stepTile, isOpen, wrapRow, DIR_KEY } from "../_helpers.mjs";

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
  const check = ttc.checkOne("states.cleared");
  const snap = await startPlaying(api);
  await api.call("poseLastPlankton");
  const f = (await api.snapshot()).forager;
  const dir = planktonDir(snap, f);
  check.expectOk("a reachable last plankton was posed", dir !== null);
  if (!dir) return check.verdict();
  await api.call("keyDown", DIR_KEY[dir]);
  let s = await api.snapshot();
  for (let i = 0; i < 60 && s.screen === "playing"; i++) {
    await api.step(0.02);
    s = await api.snapshot();
  }
  await api.call("keyUp", DIR_KEY[dir]);
  check.expectEq("clearing a trench shows the cleared screen", s.screen, "cleared");
  await api.wait(150);
  await api.screenshot("cleared");
  return check.verdict();
}
