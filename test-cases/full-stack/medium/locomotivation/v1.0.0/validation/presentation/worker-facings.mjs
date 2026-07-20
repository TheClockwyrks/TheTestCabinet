// Presentation: the worker's facing follows the pressed direction — a real down/up/left/
// right character. Each direction is held briefly and the snapshot's facing read back.

import { holdMeasure, setTile, startFresh, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("presentation.worker-facings");

  await startFresh(api, 1);
  for (const [code, facing] of [
    ["ArrowUp", "up"],
    ["ArrowDown", "down"],
    ["ArrowLeft", "left"],
    ["ArrowRight", "right"],
  ]) {
    await setTile(api, 8, 10);
    const r = await holdMeasure(api, [code], 0.12);
    check.expectEq(`holding ${code} faces the worker ${facing}`, r.snap.worker.facing, facing);
  }

  // A live clip turning through the facings.
  await setTile(api, 8, 10);
  for (const code of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"]) {
    await api.call("keyDown", code);
    await liveClip(api, 220);
    await api.call("keyUp", code);
    await api.call("setAutoStep", false);
  }
  return check.verdict();
}
