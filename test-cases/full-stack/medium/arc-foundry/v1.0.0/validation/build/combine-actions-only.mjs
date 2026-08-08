// Automated validation for build.combine-actions-only: folding pieces together offers exactly
// two operations and no third. A matching same-type, same-quality pair COMBINEs one quality tier
// higher, and a cross-type set assembles a combination tower through COMBINE SPECIAL. There is
// no action that folds a pair into a result of the same type and quality, which would spend a
// piece for nothing.
//
// A fresh candidate is placed alongside a matching standing tower — the case where a redundant
// third fold action is most tempting — and the inspector's action set is read back.
//
// WHAT THE ACTION SET IS COMPARED AGAINST. This used to require the panel's actions to equal
// exactly ["combine", "downgrade", "keep", "remove"], under an assertion labelled "...and no
// fold action beyond COMBINE and COMBINE SPECIAL" — a list that does not contain
// `comborecipe`, which IS Combine Special. So a build that offered the Combine Special the
// label expressly allows failed the assertion that allows it, and the exact-set comparison also
// pinned every NON-fold action in the panel, which this item is not about and which
// `controls/panel-layout-stable` covers properly.
//
// The comparison is now what the item says: of the actions the inspector offers, the ones that
// FOLD pieces together must be a subset of {combine, comborecipe}. A third fold action — the
// same-type, same-quality fold this item exists to catch — fails it, and nothing else does.
//
// A candidate's TARGETING control is a separate matter and is asserted separately: a candidate is
// not a firing component (`specs/build.md`: "only a component fires"), and a piece that cannot
// shoot has no target to prioritise.
//
// THE SPEC USED TO LEAVE THIS OPEN, AND ALL THREE RUN IMPLEMENTATIONS FELL THROUGH THE GAP.
// `specs/controls.md` gave the targeting cycle to "a firing component selected", which says a
// candidate should not have one; but the same file's fixed-slot rule said "every action a
// selected structure can ever offer is drawn for as long as that structure stays selected" and
// that an action not usable right now "is drawn disabled in its own slot ... never hidden,
// removed, or collapsed". A candidate is one KEEP away from firing, so the two rules pulled in
// opposite directions and every one of the three builds resolved them the other way: they drew
// the targeting slot on a candidate. All three failed this assertion, which is the signature of a
// check pinning a choice the specification left open rather than of three builds making the same
// mistake.
//
// The gap is closed in the spec rather than in the check, because there is a right answer and the
// model was simply not given it. `specs/controls.md` now says outright that a control belongs
// only to a piece that fires — absent for a candidate and for a Regulator, not merely disabled —
// and states why that does not contradict the fixed-slot rule: that rule guarantees the panel
// against changes THE PLAYER DID NOT TRIGGER, and a harvest is one they committed deliberately.
// So the assertion below stands as it was, and now asks for something the specification states.
//
// Standing the first tower up and clearing its wave is the arrange — the clear is a minute of
// walking that this item is not about, so it is skipped rather than filmed. The matching fresh
// roll, the inspector read and the fold itself are the act.

import {
  startBuild,
  placeCandidate,
  skipClearWave,
  readPanel,
  towerAt,
  snap,
  SECOND,
} from "../_helpers.mjs";

// The action identifiers `panelButtons` may report, which `specs/instrumentation.md` fixes as
// an exhaustive list ("using exactly these identifiers"), and the two of them that FOLD pieces
// together — which is what this item bounds. A third fold action is caught whatever it calls
// itself: it cannot be one of `combine`/`comborecipe` and it cannot be one of the others, so it
// is an identifier outside the table.
const PANEL_ACTIONS = [
  "keep",
  "downgrade",
  "combine",
  "comborecipe",
  "comboupgrade",
  "targeting",
  "remove",
];
const FOLD_ACTIONS = ["combine", "comborecipe"];

// A beat after the fold so the clip carries the piece that lands rather than cutting on it.
const TAIL_TICKS = 2.5 * SECOND;

export default function item() {
  // Everything `assert` reads: whether the fresh roll landed, the inspector's buttons, and the
  // board after the fold.
  let fresh;
  let buttons;
  let actions;
  let s;

  return {
    id: "build.combine-actions-only",

    async arrange(api) {
      await startBuild(api);
      await api.call("setIntegrity", 999);
      const standing = await placeCandidate(api, "capacitor", 3, 12, 7);
      await api.call("keep", standing.id); // Wave 1
      await skipClearWave(api); // reopen the build phase, instantly, filming nothing
    },

    async act(api) {
      fresh = await placeCandidate(api, "capacitor", 3, 20, 7); // a matching fresh roll

      // The press re-arms after a placement; put the held rock away so the inspector shows.
      await api.call("rightClick", 640, 400);
      await api.call("select", fresh.id);
      // The panel is read from the last RENDERED frame, and no amount of instant stepping paints
      // one. `readPanel` waits for that frame rather than for a fixed pause.
      buttons = await readPanel(api);
      actions = [...new Set(buttons.map((b) => b.action))].sort();

      // The fold a redundant action would have duplicated: the pair climbs one quality tier.
      await api.call("combine", fresh.id);
      s = await snap(api);

      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectOk("a fresh roll matching the standing tower is placed", !!fresh);
      check.expectOk("the inspector offers a COMBINE action", actions.includes("combine"));

      // Anything outside the documented table is an action the spec does not define, and the
      // only such action this board could offer is a redundant third way to fold the pair.
      const extra = actions.filter((a) => !PANEL_ACTIONS.includes(a));
      check.expectEq("...and no fold action beyond COMBINE and COMBINE SPECIAL", extra.join(","), "");
      check.expectOk(
        "...with the folds it does offer among COMBINE and COMBINE SPECIAL",
        actions.filter((a) => FOLD_ACTIONS.includes(a)).length >= 1,
      );

      // A candidate does not fire, so it has no target to prioritise and no targeting control.
      // Reported as what the panel actually held, so a failure names the offending control rather
      // than only saying one was there.
      check.expectEq(
        "a candidate offers no targeting control (only a firing component picks targets)",
        actions.includes("targeting") ? "the panel offers a targeting control" : "none offered",
        "none offered",
      );

      const combineButton = buttons.find((b) => b.action === "combine");
      check.expectOk("the COMBINE control reads as a combine", /combine/i.test(String(combineButton?.label)));

      check.expectEq("combining the pair produced one piece a quality tier higher", towerAt(s, 20, 7).quality, 4);
      check.expectEq("...as a firing component", towerAt(s, 20, 7).kind, "component");
      check.expectEq("the consumed footprint hardened into a blocker", towerAt(s, 12, 7).kind, "blocker");
      check.expectEq("consuming the fresh roll made it the harvest, launching the wave", s.phase, "wave");
    },
  };
}
