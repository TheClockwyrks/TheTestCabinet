// Automated validation for combos.lands-level0: a newly assembled combination tower lands at
// upgrade level 0 (its reduced landing block), so assembling it is a step up, not a cliff.
//
// Assembling the recipe is all control ops (the arrange). The act reads the freshly landed
// combo and holds on it — a fresh-consuming recipe is the level's harvest, so Wave 1 is already
// running and the clip shows the new combo taking its first shots at level 0.

import { assembleCombo, towerById, snap, SECOND } from "../_helpers.mjs";

// Long enough to watch the combo take its first shots. The wave the fold launched has to walk
// the corridor before it can be shot at, so that walk is skipped rather than filmed.
const CLIP_TICKS = 3 * SECOND;
/** Skip the launched wave's walk until one of its units is nearly in the combo's reach, so the
 * clip opens on the tower about to work rather than on an empty corridor. Instant in both
 * passes, so it changes no verdict. */
async function skipToFirstContact(api, comboId) {
  const t = towerById(await snap(api), comboId);
  if (!t) return;
  await api.skipUntil(
    (s) => s.units.some((u) => Math.hypot(u.x - t.cx, u.y - t.cy) <= t.range + 40),
    { max: 60 * SECOND, poll: 3 },
  );
}


export default function item() {
  // The combo id, and the tower as it landed, read by `assert`.
  let comboId;
  let c;

  return {
    id: "combos.lands-level0",

    async arrange(api) {
      ({ comboId } = await assembleCombo(api, "fusecluster", { seed: 1, charge: 400, clear: false }));
      await skipToFirstContact(api, comboId);
    },

    async act(api) {
      c = towerById(await snap(api), comboId);
      await api.advance(CLIP_TICKS);
      await api.screenshot("level0");
    },

    async assert(api, check) {
      check.expectEq("a freshly assembled combo lands at upgrade level 0", c.level, 0);
    },
  };
}
