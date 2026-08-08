// Automated validation for build.downgrade-restrictions: only a candidate at Tuned (T2) or
// above can be downgraded; a Scrap (T1) candidate cannot, so the control is a fresh-roll-only
// correction.
//
// WHAT IS FILMED, AND WHY THIS IS NO LONGER A STILL. The evidence used to be one frame taken
// after a downgrade was attempted on a Scrap candidate — which, when the build gets it right, is
// a frame of a Scrap candidate standing exactly where it was. Nothing in that picture is the
// restriction: it is the same image a build that was never asked would produce, and a reviewer
// looking at it cannot see a control being refused or even that one exists.
//
// The restriction is a thing the inspector SHOWS, so the clip shows it. A Tuned candidate is
// selected first and its DOWNGRADE control is live; then a Scrap candidate is selected and the
// same control, in the same slot, is inert (`specs/controls.md`: "a Scrap (T1) candidate has no
// rung below it, so the control sits disabled there"). Then the downgrade is driven anyway and
// the board does not move. A reviewer watching that sees the rule rather than its absence.
//
// The panel's `disabled` flag is asserted alongside the refusal, because the two are separate
// claims and a build can get either one wrong on its own: a control that is drawn live and then
// silently does nothing is a worse failure than one that is honestly greyed out, and only reading
// the flag can tell them apart.

import { startBuild, placeCandidate, readPanel, towerAt, snap, SECOND } from "../_helpers.mjs";

// A beat on each selection, long enough for the inspector to be read on screen.
const SELECT_TICKS = 2 * SECOND;
// A beat on the unmoved board after the refused downgrade.
const TAIL_TICKS = 2 * SECOND;

export default function item() {
  // The two candidates, the DOWNGRADE control's state under each, and the board after the
  // attempt on the Scrap one.
  let tunedId;
  let scrapId;
  let tunedButton;
  let scrapButton;
  let s;

  // Select a piece and read the DOWNGRADE control the inspector draws for it. The press re-arms
  // after a placement and a held rock replaces the inspector entirely
  // (`specs/instrumentation.md`), so the hand is emptied first.
  async function readDowngrade(api, id) {
    await api.call("rightClick", 640, 400);
    await api.call("select", id);
    const buttons = await readPanel(api);
    await api.advance(SELECT_TICKS);
    return buttons.find((b) => b.action === "downgrade") ?? null;
  }

  return {
    id: "build.downgrade-restrictions",

    async arrange(api) {
      await startBuild(api);
      // A Tuned (T2) candidate, which CAN be downgraded, and a Scrap (T1) one, which cannot.
      // Both are on the board at once so the contrast is a selection apart rather than a cut.
      const tuned = await placeCandidate(api, "capacitor", 2, 6, 7);
      const scrap = await placeCandidate(api, "capacitor", 1, 10, 7);
      tunedId = tuned.id;
      scrapId = scrap.id;
    },

    async act(api) {
      // The control as it reads on a candidate that has a rung below it.
      tunedButton = await readDowngrade(api, tunedId);
      // ...and on one that does not.
      scrapButton = await readDowngrade(api, scrapId);

      // Driven anyway: the Scrap candidate stays a candidate and no wave is launched.
      await api.call("downgrade", scrapId);
      s = await snap(api);

      await api.advance(TAIL_TICKS);
    },

    async assert(api, check) {
      check.expectOk("the inspector draws a DOWNGRADE control for a Tuned (T2) candidate", !!tunedButton);
      check.expectEq("...and it is usable there", tunedButton?.disabled, false);

      check.expectOk(
        "the same control holds its slot on a Scrap (T1) candidate",
        !!scrapButton,
      );
      check.expectEq(
        "...but is disabled, because Scrap has no rung below it",
        scrapButton?.disabled,
        true,
      );

      check.expectEq("a Scrap (T1) candidate is not downgraded (still a candidate)", towerAt(s, 10, 7).kind, "candidate");
      check.expectEq("...still at Scrap", towerAt(s, 10, 7).quality, 1);
      check.expectEq("...and no wave was launched", s.phase, "build");
    },
  };
}
