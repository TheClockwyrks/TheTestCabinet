// star-core/core-costs-no-life — the core is solid and never lethal.
//
// `specs/collision.md` gives the ship and the core their own row in the table of
// pairs — "The slide, below. No life is lost and the ship is not destroyed" — and
// says it again under the slide itself: "The core is solid but never lethal to the
// ship." `specs/field.md` calls the core the one physical boundary on the field.
// This item decides that sentence and nothing else: not where the ship ends up, not
// what its velocity becomes — those are the four items beside this one — only that
// the run survives the contact intact.
//
// THE SHIP'S LETHAL CONTACT TEST IS TURNED BACK ON, and this is one of the few
// checks in the suite that does it. `startPlaying` holds it off so that no scenario
// pays for a bystander it did not ask for, but here the gate IS the requirement:
// against the default this item would pass on a build that kills the ship the
// moment it touches the star, because the gate would have suppressed the death the
// item exists to forbid. `specs/instrumentation.md` is explicit that the gate and
// this rule are separate — "setShipCollision leaves the ship-and-core rule alone:
// the slide is a separate, non-lethal interaction and runs whether the gate is on
// or off" — so the gate on is the honest reading, and the check confirms the
// surface actually took it before driving anywhere.
//
// THE APPROACH IS HEAD-ON, straight down the star's column from `200` units above
// it. The whole velocity is heading into the core, so a conformant build takes all
// of it off and leaves the ship STANDING ON THE SURFACE for the rest of the drive —
// better than a second of continuous contact, tick after tick, rather than the
// single tick a graze gives. A build that costs a life on any one of them fails.
//
// AND THE FIELD IS OTHERWISE EMPTY. `startPlaying` clears every roster, removes the
// saucer and holds the wave loop and the saucer's arrival off, so the only body the
// ship can reach is the core and the only thing that could take a life is the thing
// under test. The ship's respawn grace is SET to `0` and read back before the drive,
// so nothing is being suppressed by `specs/progression.md`'s window either: a build
// that opens a run with grace still running would otherwise survive this drive
// whatever its core does, and pass an item it never answered.
//
// TWO READINGS, BOTH FROM THE REVIEW ITEM. Every ship is still in hand —
// `START_LIVES`, which `specs/progression.md` fixes at `3` and which counts the one
// being flown — and the game is still on the playing screen, so a build that ran
// the death without spending a life, and dropped the run to `gameover`, fails too.

import { afterEach, beforeEach, it } from "vitest";
import { START_LIVES } from "../constants";
import { assertEqual, fail } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { contactOf, driveIntoTheCore, poseHeadOnApproach } from "./strike";

/**
 * How long the ship is driven: one and a half seconds.
 *
 * The run-in down the star's column is four tenths of a second at
 * `APPROACH_SPEED`, so the rest of it — better than a hundred and thirty ticks — is
 * the ship resting against the core with its whole approach taken off. Every one of
 * those ticks is another chance for a build that treats the core as lethal to take
 * a life.
 */
const DRIVE_TICKS = ticksFor(1.5);

/** The respawn grace the ship is driven in with: none, so nothing suppresses a death. */
const NO_GRACE = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("costs the run nothing when the ship is driven onto the core and held there", async () => {
  startPlaying(h);
  h.debug.setShipCollision(true);
  h.debug.setShipInvuln(NO_GRACE);
  poseHeadOnApproach(h);

  const posed = h.snapshot();
  assertEqual(
    posed.ship.invuln,
    NO_GRACE,
    "the seconds of respawn grace the ship carries into the core, which must " +
      "be none for the contact to be the only thing that could take a life " +
      "(specs/instrumentation.md)",
  );
  if (!posed.ship.collision) {
    fail(
      "the ship's lethal contact test on, which is what this item is about " +
        "(specs/instrumentation.md: setShipCollision gates the ship's lethal " +
        "contact test, and the snapshot reports it)",
      posed.ship.collision,
    );
  }

  const drive = await driveIntoTheCore(h, DRIVE_TICKS);
  contactOf(drive);
  captureStill(h, "intact");

  const snapshot = h.snapshot();
  assertEqual(
    snapshot.lives,
    START_LIVES,
    "ships left after the ship was driven onto the star's core and held " +
      "against it, with its lethal contact test on (specs/collision.md: the " +
      "ship and the core, no life is lost and the ship is not destroyed)",
  );
  assertEqual(
    snapshot.screen,
    "playing",
    "the screen after the same contact (specs/collision.md: the core is " +
      "solid but never lethal to the ship)",
  );
});
