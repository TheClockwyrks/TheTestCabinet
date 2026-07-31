// Automated validation for build.explicit-set-folds-exactly: when the player shift-selects the
// exact pieces to fold, the combine folds precisely that multiset — even when the same initiator
// could satisfy a different fold from the same board.
//
// Every other combine item in this case poses a board that affords exactly ONE fold, so the
// ingredients the build picks and the ingredients the player picked are the same set and no check
// can tell which one decided. This item is the one that pulls them apart. `specs/controls.md`:
// "Combining then folds exactly that set (a matched pair, or a recipe multiset), so a player can
// choose precisely which duplicate copies to fold"; `specs/instrumentation.md` on `combine`: "If a
// `combineSet` is set it folds exactly that set; otherwise it auto-resolves the ingredients".
//
// THE CONTESTED BOARD. Four Scrap candidates: a Rectifier PAIR, plus the Regulator and Arc-Node
// that complete the Fuse Cluster recipe (`specs/towers.md`) around one of those Rectifiers. From
// that Rectifier initiator, two different folds are legal at the same instant — a quality-combine
// of the pair, and the recipe. Which one happens is the player's to decide, and the explicit set
// is how they say so.
//
// WHAT IS AND IS NOT GRADED. The item grades one direction only: the explicit PAIR must climb the
// pair. It deliberately does not grade what an UN-targeted combine does with the same board, and
// nothing here reads a panel. No spec ranks a quality-combine against a recipe when the player has
// named neither — `specs/controls.md` makes COMBINE and COMBINE SPECIAL two separate actions the
// player chooses between, and the debug API's single `combine(initiatorId)` collapses both into
// one call without saying which wins. Grading that would pin a free choice.
//
// The other direction is posed anyway, first and instantly, as this scenario's PRECONDITION: the
// same four pieces, with the recipe multiset chosen explicitly, must assemble the Fuse Cluster.
// That is what makes the contested board contested. A build that cannot assemble it has not posed
// two competing folds, so there is no choice to grade and the item is inconclusive rather than
// failed — `combos/recipe-assembles` is the item that grades whether a recipe assembles at all,
// and one item failing for it is the right blast radius.

import {
  startBuild,
  placeCandidate,
  towerAt,
  snap,
  unmetPrecondition,
  SPOTS,
  SECOND,
} from "../_helpers.mjs";

// The contested board, in placement order: the initiator and its matching partner, then the two
// pieces that complete a recipe around the initiator. The anchors are the corridor spots the rest
// of the case builds on, so the piece the fold leaves standing covers the route and the clip has
// the launched wave walking into it.
const INIT = SPOTS[0]; // Rectifier @ Scrap — the piece both folds initiate from
const PARTNER = SPOTS[1]; // Rectifier @ Scrap — the quality-combine's other half
const REG = SPOTS[2]; // Regulator @ Scrap — Fuse Cluster ingredient
const NODE = SPOTS[3]; // Arc-Node  @ Scrap — Fuse Cluster ingredient

// Long enough to carry the piece the fold produced and the wave the harvest launched, rather than
// cutting on the combine flash.
const TAIL_TICKS = 4 * SECOND;

/**
 * Pose the contested board through the real placement path and return the four pieces.
 *
 * A refused placement means the scenario never existed: these are ordinary open corridor anchors,
 * clear of every waypoint platform and sealing nothing, so a build that refuses one has posed no
 * contested board to grade (`pathing/never-seal-refused` is the item that grades refusals).
 */
async function poseContestedBoard(api) {
  await startBuild(api);
  // The fold is the level's harvest, so it launches Wave 1 behind the measurement. Put Grid
  // Integrity out of reach so an unopposed wave cannot overload the run mid-clip.
  await api.call("setIntegrity", 999);
  const pieces = {};
  for (const [name, type, spot] of [
    ["init", "rectifier", INIT],
    ["partner", "rectifier", PARTNER],
    ["reg", "regulator", REG],
    ["node", "arcnode", NODE],
  ]) {
    const cand = await placeCandidate(api, type, 1, spot.col, spot.row);
    if (!cand) {
      throw unmetPrecondition(
        `the ${name} piece was refused at (${spot.col},${spot.row}); the contested board could ` +
          `not be posed, so there are no two competing folds to choose between`,
      );
    }
    pieces[name] = cand;
  }
  return pieces;
}

export default function item() {
  // The board after the graded fold, and the ids the act folds.
  let initId;
  let s;

  return {
    id: "build.explicit-set-folds-exactly",

    async arrange(api) {
      // PRECONDITION, instantly and off camera: the recipe really is reachable from this board and
      // this initiator. Same four pieces, recipe multiset chosen explicitly.
      const first = await poseContestedBoard(api);
      // Primary first. An explicit set is the primary selection plus the pieces shift-added
      // "alongside the primary" (`specs/controls.md`), and the fold lands at the primary — which
      // is the piece the combine is triggered from. A set that names some other piece first is
      // not this initiator's set at all.
      await api.call("setCombineSet", [first.init.id, first.reg.id, first.node.id]);
      await api.call("combine", first.init.id);
      const posed = towerAt(await snap(api), INIT.col, INIT.row);
      if (!posed || posed.kind !== "combo") {
        throw unmetPrecondition(
          `the Fuse Cluster recipe did not assemble from the contested board (the initiator's ` +
            `footprint holds ${posed ? posed.kind : "nothing"}), so the board affords only one ` +
            `fold and there is no choice for an explicit selection to decide`,
        );
      }

      // Now re-pose the same board and hand the act the fold this item grades. A reset in
      // `arrange` is free — nothing is filmed and no time is consumed in either pass.
      const second = await poseContestedBoard(api);
      initId = second.init.id;
      // The explicit selection: exactly the matching pair, and nothing else.
      await api.call("setCombineSet", [second.init.id, second.partner.id]);
    },

    async act(api) {
      await api.call("combine", initId);
      s = await snap(api);

      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      const at = towerAt(s, INIT.col, INIT.row);

      // The two folds land mutually exclusive things on the initiator's footprint: a quality-
      // combine leaves a base component one tier up, a recipe leaves a combination tower (which
      // carries no quality tier at all, `specs/build.md`). So what stands there says which set was
      // folded, without depending on how the build reports anything else.
      check.expectEq(
        "the pair the player chose is what folded: a base component stands at the initiator",
        at ? at.kind : null,
        "component",
      );
      check.expectEq("...of the pair's own type", at ? at.type : null, "rectifier");
      check.expectEq("...one quality tier above the pair", at ? at.quality : null, 2);
    },
  };
}
