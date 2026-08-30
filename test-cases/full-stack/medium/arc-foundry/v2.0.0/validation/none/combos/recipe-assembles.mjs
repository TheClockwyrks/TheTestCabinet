// Automated validation for combos.recipe-assembles: a recipe-combine folds a specific multiset
// of base (type, quality) ingredients into one combination tower at the initiating piece's
// footprint, and every consumed ingredient footprint hardens into a blocker.
//
// WHAT IS FILMED. The fold used to happen entirely in `arrange`, which is instant in both passes,
// so the recording opened on a board where the combination tower already stood and the one event
// this item is about — a multiset of base parts BECOMING one tower — had happened before the
// first frame. All a reviewer could see was a combo standing among some blockers, which is the
// aftermath and not the claim.
//
// So the ingredients are posed in `arrange` and the fold is committed in `act`, after a beat on
// the board that affords it. The clip is then the sentence the item states: four base pieces
// standing, the fold, and the tower that replaces them with every consumed footprint hardened.

import { arrangeComboBoard, commitCombo, towerAt, towerById, snap, SECOND } from "../_helpers.mjs";

// A beat on the ingredient board before the fold, so the pieces the recipe consumes are on screen
// as pieces first.
const LEAD_TICKS = 2 * SECOND;
// Long enough to watch the assembled combo stand among its hardened ingredients AND take its
// first shots at the wave the fold launched. Two seconds cut away before the Load arrived.
const CLIP_TICKS = 4 * SECOND;
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
  // The fold's outputs and the board it left behind, all read by `assert`.
  let comboId;
  let ingredients;
  let initiatorId;
  let s;

  return {
    id: "combos.recipe-assembles",

    async arrange(api) {
      ({ ingredients, initiatorId } = await arrangeComboBoard(api, "fusecluster", { seed: 1 }));
    },

    async act(api) {
      // The board that affords the recipe, before anything folds it.
      await api.advance(LEAD_TICKS);

      comboId = await commitCombo(api, initiatorId);
      s = await snap(api);

      // A fresh-consuming recipe is the level's harvest, so Wave 1 is now running. Skip the walk
      // up the corridor (instant in both passes) so the clip carries the new tower actually
      // working rather than an empty yard.
      await skipToFirstContact(api, comboId);
      await api.advance(CLIP_TICKS);
    },

    async assert(api, check) {
      // Hard: everything below reads the assembled piece, so a fold that produced none has
      // nothing to grade. Stopping here records a clean failed verdict on the claim that was
      // actually broken; carrying on would dereference a missing tower and report the item as
      // a debug-API contract failure, which says the build answered the API wrongly when in
      // fact it answered correctly and assembled nothing.
      check.assertOk("a combination tower was assembled", comboId != null);

      const combo = towerById(s, comboId);
      check.expectEq("the assembled piece is a combo (single-grade, no quality tier)", combo.kind, "combo");
      check.expectEq("...of the expected recipe (Fuse Cluster)", combo.type, "fusecluster");

      // Read the aftermath by FOOTPRINT, not by id. The combo lands on the initiator's
      // footprint and `specs/build.md` hardens every OTHER consumed ingredient's footprint
      // into an inert blocker — a claim about tiles. A consumed piece is gone either way; a
      // build may harden it in place under its old id or drop a fresh blocker on the same
      // tiles, and no spec chooses between those. Looking the old ids up in the snapshot
      // graded that choice instead: it read "assembled correctly, then discarded the
      // ingredients' ids" as "the maze opened a hole", the one thing wall-neutrality forbids.
      const consumed = ingredients.filter((g) => !(g.col === combo.col && g.row === combo.row));
      const hardened = consumed.filter((g) => towerAt(s, g.col, g.row)?.kind === "blocker");
      check.expectEq(
        "every consumed ingredient footprint hardened into a blocker",
        `${hardened.length} of ${consumed.length}`,
        `${consumed.length} of ${consumed.length}`,
      );
    },
  };
}
