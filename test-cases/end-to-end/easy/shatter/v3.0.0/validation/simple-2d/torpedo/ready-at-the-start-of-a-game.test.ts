// torpedo/ready-at-the-start-of-a-game — a game opens with the torpedo charged.
//
// `specs/weapons.md`, "The charge": "The ship holds one torpedo charge, a number
// from `0` to `1`. A game begins with the charge at `1`, ready to fire." And
// `specs/instrumentation.md` fixes the reading: `torpedoCharge` is the stored
// number, and `torpedoReady` is `true` exactly when that charge is `1`. So the
// opening state is two readings of one rule, and both are taken here.
//
// THE GAME IS OPENED THE WAY A PLAYER OPENS ONE, and it has to be. No pose can
// produce a new game: `setTorpedoCharge` would set the very number under test, so
// a check that posed the answer would compare the build against itself. `reset()`
// puts the build back on the title with the highlight on `PLAY`
// (`specs/instrumentation.md`, `specs/ui.md`), the entry is confirmed with the
// `confirm` action, and what is read afterwards is what the build's own new-game
// path built. That route leaves both world gates on — `reset` restores them — so
// this is a real opening wave, which is the point.
//
// THE CHARGE IS DRIVEN OFF FULL BEFORE THE GAME IS OPENED, and that is what makes
// the item decidable rather than vacuous. `reset` itself sets the charge to `1`
// (`specs/instrumentation.md`), so a check that reset and confirmed would read a
// figure the RESET put there and would pass a build whose new-game path never
// touches the charge at all. Posing it part full on the title first means the `1`
// read afterwards can only have come from the game beginning — which is the
// sentence being graded. The pose is read back before `PLAY` is confirmed, so a
// build whose `setTorpedoCharge` does nothing fails naming the pose rather than
// scoring a rule it was never asked to obey. (`instrumentation/poses-read-back`
// is the item that GRADES that operation.)
//
// THE SCREEN IS CONFIRMED BEFORE THE CHARGE IS READ. A build that never left the
// title has not begun a game at all, and "a game begins with the charge at 1" is
// not decidable against one that never did; the check names that as what it needed
// rather than reading a title screen's charge and calling it an opening.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  tapAction,
  type Harness,
} from "../harness";
import { DEFAULT_SEED } from "../surface";
import { chargeOf, readyOf, setCharge } from "./scene";

/** The charge a game opens on (`specs/weapons.md`). */
const FULL = 1;

/**
 * The charge the title is left holding, so the reading after `PLAY` is the new
 * game's own.
 *
 * `0.4` is the check's to choose: `specs/weapons.md` fixes what a game BEGINS
 * with, not what a title screen holds, and nothing about the figure matters beyond
 * its being nowhere near `1`.
 */
const TITLE_CHARGE = 0.4;

/** How closely that pose must read back before the scenario counts as arranged. */
const POSE_READBACK = 1e-3;

/**
 * How far from `1` the opening charge may read.
 *
 * Float slack, not room on the figure: `specs/weapons.md` opens a game at `1`
 * exactly. A build that carried the posed `0.4` into the game reads six tenths out,
 * six hundred times this.
 */
const OPENING_SLACK = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a game with the charge full and the torpedo ready", async () => {
  h.debug.reset({ seed: DEFAULT_SEED });
  setCharge(h, TITLE_CHARGE);

  const title = h.snapshot();
  if (title.screen !== "title") {
    fail(
      "the build back on the title screen after reset(), so a game can be " +
        "opened from it (specs/instrumentation.md)",
      `the build was on the ${title.screen} screen`,
    );
  }
  const stood = chargeOf(title, "the charge posed on the title screen");
  if (Math.abs(stood - TITLE_CHARGE) > POSE_READBACK) {
    fail(
      `a charge posed at ${TITLE_CHARGE} before the game is opened, so the ` +
        "reading afterwards is the new game's own " +
        "(specs/instrumentation.md: setTorpedoCharge sets the stored charge)",
      `the build reported a charge of ${stood}`,
    );
  }

  // `reset` leaves the highlight on entry 0, which `specs/ui.md` makes `PLAY`.
  await tapAction(h, "confirm");
  const opened = h.snapshot();
  // The fresh game, its charge indicator full.
  captureStill(h, "charged");

  if (opened.screen !== "playing") {
    fail(
      "a game opened from the title by confirming PLAY, so the charge a new " +
        "game begins with can be read (specs/ui.md, specs/weapons.md)",
      `the build was on the ${opened.screen} screen`,
    );
  }

  assertLessThanOrEqual(
    Math.abs(chargeOf(opened, "a game just opened from the title") - FULL),
    OPENING_SLACK,
    `the torpedo charge a new game begins with, having stood at ` +
      `${TITLE_CHARGE} on the title (specs/weapons.md: a game begins with the ` +
      "charge at 1, ready to fire)",
  );
  assertEqual(
    readyOf(opened, "a game just opened from the title"),
    true,
    "torpedoReady on a new game, which specs/instrumentation.md makes true " +
      "exactly when the charge is 1",
  );
});
