// scoring.cleared-bonus: eating the last plankton clears the trench for a 500 bonus.
import { startPlaying, stepTile, isOpen, wrapRow, DIR_KEY, SCORE_CLEAR, clip } from "../_helpers.mjs";

// The neighbor debugPoseLastPlankton places the single remaining plankton on: the
// first open, non-wrap neighbor in the order up, down, left, right.
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
  const check = ttc.checkOne("scoring.cleared-bonus");
  const snap = await startPlaying(api);
  await api.call("poseLastPlankton");
  const f = (await api.snapshot()).forager;
  const dir = planktonDir(snap, f);
  check.expectOk("a reachable last plankton was posed", dir !== null);
  if (!dir) return check.verdict();
  const before = (await api.snapshot()).score;
  await api.call("keyDown", DIR_KEY[dir]);
  const r = await (async () => {
    let s = await api.snapshot();
    for (let i = 0; i < 60 && s.screen === "playing"; i++) {
      await api.step(0.02);
      s = await api.snapshot();
    }
    return s;
  })();
  await api.call("keyUp", DIR_KEY[dir]);
  check.expectEq("eating the last plankton clears the trench", r.screen, "cleared");
  check.expectGe("clearing awards the 500 bonus", r.score - before, SCORE_CLEAR);
  await clip(api, 800);
  return check.verdict();
}
