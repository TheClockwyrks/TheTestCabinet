// star-core/core-costs-no-life — the star's core is solid, and it is not lethal.
//
// THE RULE. `specs/collision.md` gives the ship-and-core pair its own row — "The
// slide, below. No life is lost and the ship is not destroyed" — and says it again
// under the slide: "The core is solid but never lethal to the ship." Every other
// solid thing on the field kills: a rock, the saucer, and a saucer bullet each
// destroy the ship and cost a life on the same page. The core is the exception, and
// a build that resolved it through the same path as the other three would take a
// life every time a player grazed the star, which is a different game.
//
// WHY THE CONTACT GATE IS TURNED BACK ON, AGAINST THE HARNESS DEFAULT. It is this
// item's requirement rather than a convenience. `startPlaying` shuts the ship's
// lethal contact test so that a scenario about something else can pose a rock beside
// the ship without losing a life to it; but with it shut, `specs/instrumentation.md`
// says in as many words that "no contact costs anything", so this check would pass on
// a build that kills the ship on the core and would have decided nothing at all. The
// gate is the faculty being graded, so the gate is on.
//
// AND THE RESPAWN GRACE IS AT ZERO, for the same reason. `specs/progression.md`
// makes a fresh ship briefly untouchable, and inside that window every lethal pair
// costs nothing; a check that drove into the core with grace left would be reading
// the grace, not the core. Both preconditions are read back from the build before
// the drive, so a failure here is what the core did and not what the pose failed to
// arrange.
//
// WHAT IS READ. Two readings of one requirement: the ships left, and the screen.
// `specs/progression.md` fixes both halves of what losing a life looks like — the
// count falls, and when the last one goes the run ends on the game-over screen — and
// a build that took a life without falling to game over is caught by the first while
// a build that ended the run outright is caught by the second. The field holds
// nothing else that could cost a life: `startPlaying` has emptied every roster and
// shut both world gates, so the core is the only body the ship can meet.
//
// THE CONTACT IS PROVED, NOT ASSUMED. A build whose ship never reached the core
// would keep all three ships for a reason that has nothing to do with the rule, so
// the passage is required to have closed on the star before the reading counts.
//
// AND THE READING IS TAKEN AT THE END OF THE PASSAGE, not on the tick of the
// contact. `specs/progression.md` puts a destroyed ship back at the safe point, so a
// build that kills on the core moves the ship two hundred units away on the very
// tick it does it — and a check that read the tick the ship stood NEAREST the star
// would be reading the tick before the kill, with all three ships still in hand.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { START_LIVES } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  CLEARANCE,
  driveIntoTheCore,
  poseTheApproach,
  SLIDE_TICKS,
} from "./contact";

/**
 * How far outside `CORE_R + SHIP_R` the ship's path may stay and still count as
 * having met the core: `6` units.
 *
 * A scenario guard rather than a bound on the rule — a build that holds the ship
 * off further than this has failed `star-core/ship-slides-along-the-core`, which is
 * the item that grades the standoff. Here it says only that the ship really did
 * reach the core, so that keeping three ships means the core cost nothing rather
 * than that nothing happened.
 */
const REACHED = 6;

/** The seconds of respawn grace the ship carries into the core: none. */
const NO_GRACE = 0;

/** The screen a run that has not ended is on (`specs/ui.md`). */
const STILL_PLAYING = "playing" as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps every ship and stays in play when the ship is driven into the core", async () => {
  await startPlaying(h);
  await poseTheApproach(h);
  await h.debug.setShipCollision(true);
  await h.debug.setShipInvuln(NO_GRACE);

  const posed = await h.snapshot();
  assertEqual(
    posed.ship.collision,
    true,
    "the ship's lethal contact test running, which is what this item grades (specs/instrumentation.md)",
  );
  assertEqual(
    posed.ship.invuln,
    NO_GRACE,
    "the seconds of respawn grace the ship carries into the core (specs/instrumentation.md)",
  );

  const passage = await driveIntoTheCore(h, SLIDE_TICKS);
  await captureStill(h, "intact");
  if (!(passage.closest <= CLEARANCE + REACHED)) {
    fail(
      "a ship driven at the star's core reaching it (specs/collision.md)",
      `the nearest the ship's path came to the star's centre was ${passage.closest.toFixed(1)} units`,
    );
  }
  const ended = passage.samples[passage.samples.length - 1].snapshot;

  assertEqual(
    ended.lives,
    START_LIVES,
    "the ships left after driving into the core with the lethal contact test running (specs/collision.md)",
  );
  assertEqual(
    ended.screen,
    STILL_PLAYING,
    "the screen the game is on after driving into the core (specs/collision.md)",
  );
});
