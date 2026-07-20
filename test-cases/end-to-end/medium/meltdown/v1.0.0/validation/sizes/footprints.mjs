// Automated validation for the Sizes sub-item `footprints`.
//
// Arc, Stutter, Rime, Flak, Forge, and Sink are 2x2; the Bloom is 3x3; the Lance is
// 4x4 (specs/towers.md). We place each type and read its reported footprint size.

import { newGame, build, tower } from "../_helpers.mjs";

const EXPECTED = {
  arc: 2,
  stutter: 2,
  rime: 2,
  flak: 2,
  forge: 2,
  sink: 2,
  bloom: 3,
  lance: 4,
};

export default async function drive(api, ttc) {
  const check = ttc.checkOne("sizes.footprints");

  await newGame(api, "containment", "medium", 100000);
  const spots = {
    arc: [2, 2],
    stutter: [2, 6],
    rime: [2, 10],
    flak: [2, 14],
    forge: [2, 18],
    sink: [2, 22],
    bloom: [10, 2],
    lance: [16, 2],
  };
  for (const [type, [col, row]] of Object.entries(spots)) {
    const id = await build(api, type, col, row);
    const t = await tower(api, id);
    check.expectEq(`${type} footprint size`, t ? t.size : -1, EXPECTED[type]);
  }

  await api.wait(80);
  await api.screenshot("sizes");
  return check.verdict();
}
