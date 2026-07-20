// Automated validation for foes.dropper-sparse-trigger: when the lower field runs
// sparse (from level 3) a dropper draws in to reseed it; a dense field draws none.
//
// Both cases set level 3 and pose the lower-field density, then step real time so the
// game's own sparse-field check runs (game.updateFoes). A sparse lower field draws a
// dropper in; a dense one draws none. Nothing fabricates the spawn — the real check
// decides.

import { foesOf, freshBoard, liveClip } from "../_helpers.mjs";

export default async function drive(api, ttc) {
  const check = ttc.checkOne("foes.dropper-sparse-trigger");

  // Sparse lower field: a dropper should draw in.
  await freshBoard(api);
  await api.call("setLevel", 3);
  await api.call("clearField"); // lower half empty -> sparse
  await api.call("setCursor", 16, 704); // out of the way
  const sparse = (await (async () => {
    let s;
    for (let i = 0; i < 30; i++) {
      await api.step(0.15);
      s = await api.snapshot();
      if (foesOf(s, "dropper").length > 0) break;
    }
    return s;
  })());
  check.expectGt("a sparse lower field draws a dropper in", foesOf(sparse, "dropper").length, 0);

  // Dense lower field: no dropper should draw in.
  await freshBoard(api);
  await api.call("setLevel", 3);
  await api.call("clearField");
  for (let r = 10; r <= 15; r++) for (const c of [8, 20]) await api.call("setNode", c, r, 0); // 12 nodes
  await api.call("setCursor", 16, 704);
  await api.step(6);
  check.expectEq("a dense lower field draws no dropper", foesOf(await api.snapshot(), "dropper").length, 0);

  // A live clip of a dropper drawn in by a sparse field.
  await freshBoard(api);
  await api.call("setLevel", 3);
  await api.call("clearField");
  await api.call("setCursor", 16, 704);
  await liveClip(api, 3200);

  return check.verdict();
}
