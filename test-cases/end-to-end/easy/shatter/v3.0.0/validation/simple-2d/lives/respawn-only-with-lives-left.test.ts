// lives/respawn-only-with-lives-left — the last ship lost is not replaced.
//
// THE RULE. `specs/progression.md` puts a new ship up on one condition — "when a
// ship is lost AND LIVES REMAIN, the next ship appears at rest at the safe point"
// — and states the other case outright: "when the last ship is lost the life count
// reaches `0`, no new ship appears, and the game is over". This item reads the
// middle clause. The counter reaching zero is `game-over-at-zero`'s, and the screen
// it puts up is `screens/game-over-on-the-last-life`'s.
//
// ONE SHIP IS POSED, SO THE CONTACT IS THE LAST DEATH. `setLives(1)` counts the
// ship in play (`specs/instrumentation.md`: "`lives` counts every ship left
// INCLUDING the one being flown"), so the ship the Small reaches is the last one
// there is, and the respawn this item forbids is the one that would follow it.
//
// IT IS READ TWICE, AND THE TWO READINGS CATCH DIFFERENT BUILDS. The reported
// centre catches a build that places a ship at the safe point; what is PAINTED
// there catches a build that puts a ship up without moving the one the snapshot
// reports, or that draws a ship its state does not hold. Neither reading alone
// would do: the item's claim is that nothing is there, and "nothing" is both a
// position and a picture.
//
// THE PAINTED READING IS TAKEN ON THE LIVE FIELD. The last death moves the game to
// `gameover`, whose panel and menu are drawn wherever the build chose and may well
// cover the safe point — so the screen is posed back to `playing`, which spawns
// nothing and clears nothing (`specs/instrumentation.md`), one frame is run so the
// build paints it, and what is sampled is the field itself. A ship put up at the
// safe point is drawn there on that screen; a build that put none up leaves the
// patch as bare field. The safe point is `200` units from the star's centre and
// the patch reaches `16` of them toward it, so it stops clear of the `180` beyond
// which nothing of the star is drawn (`specs/field.md`) and the star cannot light
// it either.
//
// AND THE PATCH IS READ AT ITS WORST SAMPLE RATHER THAN ITS AVERAGE, because a
// build that STROKES its hull rather than filling it paints only a few of the
// samples: an average would let a wireframe ship read as bare field.
//
// WHY FIFTY OUT OF THE 441 THE RGB CUBE SPANS. `specs/overview.md` fixes no
// palette and asks only that every body read clearly apart from the field it
// stands on, so the reading is a SEPARATION between two things the build painted:
// the patch at the safe point, and the bare field sampled off the same frame.
// Fifty is this case's figure for "clearly apart" — the same one the
// `presentation` items are built on — so a patch within it holds no body.

import { afterEach, beforeEach, it } from "vitest";
import { SAFE_X, SAFE_Y } from "../../src/constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { distance } from "../geometry";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  APPROACH_GAP,
  PATCH_SAMPLES,
  ROCK_DRIFT,
  SAFE_POINT,
  SHIP_TOUCHES_SMALL,
  arrangeDoomedShip,
  centreOf,
  contactNeeded,
  patchDeparture,
  sampleBareField,
  settleRespawn,
  untilLifeLost,
} from "./scene";

/** The ships posed before the contact: the one in play, and nothing in reserve. */
const LAST_SHIP = 1;

/** How far from the safe point a ship has to stand to have been put up elsewhere. */
const PLACEMENT_TOLERANCE = 1;

/** Two colours this far apart, out of the 441 the RGB cube spans, are distinct. */
const DISTINCT = 50;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("puts no ship at the safe point when the last one is lost", async () => {
  startPlaying(h);
  h.debug.setLives(LAST_SHIP);
  arrangeDoomedShip(h);

  const lost = await untilLifeLost(h, LAST_SHIP);
  assertEqual(
    lost.hit,
    true,
    contactNeeded(
      "a drifting Small",
      APPROACH_GAP,
      SHIP_TOUCHES_SMALL,
      ROCK_DRIFT,
    ),
  );

  // The same allowance every respawn in this group is given, so a build that would
  // have put a ship up has had its chance to.
  const settled = await settleRespawn(h);
  // The live field rather than whatever the game-over screen paints over it.
  h.debug.setScreen("playing");
  await h.advance(1);
  const bare = sampleBareField(h);
  const worst = patchDeparture(h, bare);
  captureStill(h, "empty");

  assertGreaterThan(
    distance(centreOf(settled.ship), SAFE_POINT),
    PLACEMENT_TOLERANCE,
    `how far the ship's reported centre stands from the safe point ` +
      `(${SAFE_X}, ${SAFE_Y}) after the last one was lost; the build reported ` +
      `(${settled.ship.x.toFixed(2)}, ${settled.ship.y.toFixed(2)}), and no new ` +
      `ship appears when the last is lost (specs/progression.md)`,
  );
  assertLessThanOrEqual(
    worst,
    DISTINCT,
    `the furthest of ${PATCH_SAMPLES} samples across the safe point stands from ` +
      `the bare field on the same frame, out of the 441 the RGB cube spans — ` +
      `nothing is drawn there once the last ship is lost (specs/progression.md)`,
  );
});
