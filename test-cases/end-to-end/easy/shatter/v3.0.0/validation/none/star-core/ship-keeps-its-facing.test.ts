// star-core/ship-keeps-its-facing — the core turns the ship's motion and leaves the
// ship pointing where the player left it.
//
// THE RULE. `specs/collision.md`, the third step of the slide: "The ship's facing is
// unchanged, and the player keeps full control throughout." `specs/ship.md` says the
// same thing from the other side: the facing rotates "while a turn key is held" and
// at no other time, and "Rotation changes the facing alone and never the velocity."
// So a contact that swung the ship's motion through fifty-four degrees must leave
// its nose exactly where it was.
//
// WHY THIS IS ITS OWN POINT. It is the one part of the slide a build gets wrong by
// trying to be helpful. Nosing the ship along the surface as it grazes, or turning
// it to face out of the well, looks plausible in motion and is a different game:
// the player who lines a shot up on a rock and clips the star loses the shot. The
// three other slide items read the position and the velocity and would every one of
// them pass a build that did it.
//
// THE FACING IS POSED WHERE NOTHING CAN CLAIM IT. `./contact.ts` poses `100`
// degrees, which is at least twenty-six degrees from the course the ship is flying,
// from the outward and inward directions at the contact, and from both directions
// along the surface — so a build that turns the ship to face along its motion, out
// along the normal, or around the surface reads a different angle from a build that
// leaves the facing alone, and the failure names which.
//
// WHAT IS COMPARED. The facing on the tick before the contact against the facing on
// the tick the contact resolved, so what is read is what the CONTACT did rather than
// anything the drive did on its way in. No key is held, so `specs/ship.md` leaves
// nothing else that may turn the ship at all.
//
// WHY A TEN-THOUSANDTH OF A RADIAN. The specification allows the contact no turn
// whatever, so the bound has nothing to absorb but the representation: a build that
// keeps its facing in a canonical range, or reconstructs it from its sine and
// cosine, moves it by around a hundred-millionth of that. And it is a
// twenty-five-thousandth of the `2.5` degrees one tick of a held turn key would
// produce at `SHIP_TURN`, so nothing a build could mistake for a turn fits inside it.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { angleBetween } from "../geometry";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  CONTACT_FACING,
  driveIntoTheCore,
  poseTheApproach,
  requireContact,
  SLIDE_TICKS,
} from "./contact";

/** The radians the contact is allowed to move the facing by. See the header. */
const FACING_TOLERANCE = 1e-4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the ship's facing exactly where the contact found it", async () => {
  await startPlaying(h);
  await poseTheApproach(h);

  const passage = await driveIntoTheCore(h, SLIDE_TICKS);
  await captureStill(h, "facing");
  const contact = requireContact(passage, "the facing through a contact");

  assertLessThanOrEqual(
    angleBetween(contact.after.angle, contact.before.angle),
    FACING_TOLERANCE,
    `the radians the contact turned a ship posed facing ${(CONTACT_FACING * 180) / Math.PI} degrees, which it leaves unchanged (specs/collision.md)`,
  );
});
