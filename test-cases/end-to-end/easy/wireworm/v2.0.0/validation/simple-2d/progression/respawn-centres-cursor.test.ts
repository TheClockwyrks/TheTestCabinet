// progression/respawn-centres-cursor — a lost life puts the cursor back at the
// middle of the band.
//
// THE RULE. `specs/progression.md`, *Losing a life*, step 3: *the cursor is placed
// at the band's center, `(640, 688)`*. `specs/board.md` fixes the same point as
// the centre of the player band, and `harness.ts` derives it from the clamp bounds
// `specs/cursor.md` states rather than restating the pair, so the check and the
// band cannot drift apart.
//
// THE CURSOR IS PARKED AS FAR FROM THE ANSWER AS THE BAND ALLOWS. It is posed on
// the band's bottom-left corner, `(CURSOR_X_MIN, CURSOR_Y_MIN)`, which is 624
// units from the centre — twenty tiles, and nineteen tiles outside the tolerance
// below. A build that leaves the cursor where the contact found it therefore reads
// a wholly different place, and a build that recentres only one axis reads wrong
// on the other.
//
// The contact is made on whatever tile the cursor is standing on, so the parking
// spot decides the scenario and nothing else has to move.

import { afterEach, beforeEach, it } from "vitest";
import {
  CURSOR_X_MIN,
  CURSOR_Y_MIN,
  START_LIVES,
  TILE,
} from "../../src/constants";
import { assertLessThanOrEqual } from "../assert";
import {
  BAND_CX,
  BAND_CY,
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { poseContact } from "./scenario";

/**
 * How far off the band's centre the respawned cursor may sit, in logical units.
 *
 * One tile, which is the tolerance the point is stated with. The specification
 * fixes the exact point `(640, 688)`, so this is slack for a build that recentres
 * to its own idea of the middle rather than licence to land somewhere else: the
 * parking spot below is nineteen tiles outside it.
 */
const CENTRE_TOLERANCE = TILE;

/**
 * How long the contact is given to resolve, in frames. A thirtieth of
 * `RESPAWN_TIME` (`1.4` s), so the reading lands inside the respawn window, before
 * anything else could move the cursor.
 */
const CONTACT_FRAMES = ticksFor(0.05);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("puts the cursor back at the band's centre", async () => {
  startPlaying(harness);
  harness.debug.setLives(START_LIVES);
  // The far corner of the band, so nothing about the answer is where it started.
  harness.debug.setCursor(CURSOR_X_MIN, CURSOR_Y_MIN);
  poseContact(harness);

  await harness.advance(CONTACT_FRAMES);

  captureStill(harness, "centred");
  const { cursor } = harness.snapshot();
  const offset = Math.hypot(cursor.x - BAND_CX, cursor.y - BAND_CY);
  assertLessThanOrEqual(offset, CENTRE_TOLERANCE, "distance from (640, 688)");
});
