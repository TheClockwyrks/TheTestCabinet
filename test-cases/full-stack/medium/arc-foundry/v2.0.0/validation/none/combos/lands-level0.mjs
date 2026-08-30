// Automated validation for combos.lands-level0: a newly assembled combination tower lands at
// upgrade level 0 (its reduced landing block), so assembling it is a step up, not a cliff.
//
// WHAT IS FILMED, AND WHY THIS IS NO LONGER A STILL. The fold used to happen entirely in
// `arrange`, which is instant in both passes, and the evidence was a frame taken afterwards. The
// claim is about the level a combo LANDS AT, and a picture of a combination tower reading level 0
// cannot show that it landed there — it is equally what a tower that has been standing at level 0
// for a while looks like, or one that landed higher and was never upgraded. What makes it a
// landing is the assembly immediately before it.
//
// So the ingredients are posed in `arrange`, the fold is committed on camera, and the clip carries
// the tower from the instant it appears: the recipe folds, a combination tower stands where the
// initiator was, and its inspector reads level 0 as it takes its first shots.
//
// The level is read the moment the fold resolves, not at the end of the clip, so an upgrade bought
// later (or a build that climbs the level on its own) could not be mistaken for the landing value.

import {
  arrangeComboBoard,
  commitCombo,
  towerById,
  snap,
  SECOND,
} from "../_helpers.mjs";

// A beat on the ingredient board before the fold, so the landing has a visible starting point.
const LEAD_TICKS = 2 * SECOND;
// Long enough to watch the combo take its first shots at the wave the fold launched.
const CLIP_TICKS = 3 * SECOND;

/** Skip the launched wave's walk until one of its units is nearly in the combo's reach, so the
 * clip shows the tower about to work rather than an empty corridor. Instant in both passes, so it
 * changes no verdict. */
async function skipToFirstContact(api, comboId) {
  const t = towerById(await snap(api), comboId);
  if (!t) return;
  await api.skipUntil(
    (s) => s.units.some((u) => Math.hypot(u.x - t.cx, u.y - t.cy) <= t.range + 40),
    { max: 60 * SECOND, poll: 3 },
  );
}

export default function item() {
  // The posed board, the combo the fold produced, and the tower as it landed.
  let initiatorId;
  let comboId;
  let c;

  return {
    id: "combos.lands-level0",

    async arrange(api) {
      ({ initiatorId } = await arrangeComboBoard(api, "fusecluster", { seed: 1 }));
    },

    async act(api) {
      // The board that affords the recipe, before anything folds it.
      await api.advance(LEAD_TICKS);

      comboId = await commitCombo(api, initiatorId);
      // Read the level at the instant of landing, so a later climb cannot be read as the value it
      // landed at.
      c = towerById(await snap(api), comboId);

      await skipToFirstContact(api, comboId);
      await api.advance(CLIP_TICKS);
    },

    async assert(api, check) {
      // Hard: the reading below is a property OF the assembled tower, so a fold that produced
      // none has nothing to grade. Stopping here records a clean failed verdict on the claim that
      // actually broke; carrying on would dereference a missing tower and report the item as a
      // debug-API contract failure, which says the build answered the API wrongly when in fact it
      // answered correctly and assembled nothing.
      check.assertOk("a combination tower was assembled", comboId != null && c != null);
      check.expectEq("a freshly assembled combo lands at upgrade level 0", c.level, 0);
    },
  };
}
