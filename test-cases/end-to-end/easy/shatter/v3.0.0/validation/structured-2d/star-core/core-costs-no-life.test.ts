// star-core/core-costs-no-life — the core is solid, and it is never lethal.
//
// THE RULE. `specs/collision.md`'s pair table: "The ship and the core | The
// slide, below. NO LIFE IS LOST AND THE SHIP IS NOT DESTROYED", and the slide's
// own paragraph opens "The core is solid but never lethal to the ship". Every
// other pair in that table that names the ship costs a life; this one is the
// exception, and this item is that exception.
//
// WHY THE LETHAL CONTACT GATE IS TURNED BACK ON. Because it is this item's
// REQUIREMENT rather than a nuisance. `startPlaying` leaves
// `setShipCollision(false)`, under which no contact of any kind costs anything —
// so against that default a build that kills the ship on the core would pass
// vacuously, and the point would grade nothing. Turned on, the ship's lethal
// contact test is running for the whole approach and the core is the only body
// on the field, so "no life is lost" is a statement about what the core did.
// `specs/instrumentation.md` is explicit that the gate leaves the ship-and-core
// rule alone — "the slide is a separate, non-lethal interaction and runs whether
// the gate is on or off" — so the slide itself is unaffected by turning it on,
// and `instrumentation/ship-collision-gate` is where the gate's own behaviour is
// graded.
//
// AND WHY NO GRACE IS STANDING. `startPlaying` leaves `invuln` at `0`.
// `specs/collision.md` excuses the three lethal pairs inside the respawn window,
// so a check that left grace running would be reading the grace rule rather than
// the core rule — and `lives/invuln-ignores-a-rock` is where that one belongs.
//
// WHAT IS READ. The ships left and the screen, after a graze that put the ship
// on the core and carried it away again. `specs/progression.md` spends a ship on
// a destruction, so a build that treats the core as lethal reports `2` here
// instead of `START_LIVES` (`3`), and one that treats it as lethal on a game
// with one ship left would leave the `"playing"` screen for `"gameover"` — the
// two readings the review item names, one for each of the ways the destruction
// shows.
//
// THE APPROACH REACHED THE CORE. Asserted, and asserted FIRST, because the item
// is decided by nothing happening: a scenario that never brought the ship to the
// core would report three ships and the playing screen for the wrong reason. The
// closest approach is held to `CORE_R + SHIP_R` (`44`) or nearer, which is the
// ship's circle touching the core. That is a precondition on the SCENARIO and not
// a second requirement: a build that holds the ship at the wrong standoff fails
// `ship-slides-along-the-core`, and the bound here is loose enough — one unit
// over the surface, against the `14` a build with no boundary at all comes
// inside it — that only a scenario that missed the core entirely trips it.

import { afterEach, beforeEach, it } from "vitest";
import { START_LIVES } from "../../src/constants";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { SURFACE, grazeTheCore, showTheContact } from "./approach";

/**
 * How far outside `CORE_R + SHIP_R` the closest approach may sit and still count
 * as having reached the core, in units.
 *
 * A precondition on the scenario, not a threshold on the rule: it decides only
 * that the ship's circle met the core at all. One unit is the same latitude
 * `ship-slides-along-the-core` allows the standoff itself, and every build that
 * fails to stop the ship comes fourteen units further in than this.
 */
const REACHED_SLACK = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("costs the ship nothing when it is driven into the core with its contact test on", async () => {
  startPlaying(h);
  // This item's requirement: the ship's lethal contact test running while the
  // one body it can meet is the core.
  h.debug.setShipCollision(true);

  const graze = await grazeTheCore(h);
  const after = h.snapshot();

  // The ship on the core with every life intact.
  await showTheContact(h, graze);
  captureStill(h, "intact");

  const closest = graze.range[graze.contact];
  assertLessThanOrEqual(
    closest - SURFACE,
    REACHED_SLACK,
    "the ship's circle to have reached the core over the approach — its " +
      `centre within CORE_R + SHIP_R (${SURFACE}) of the star's centre, ` +
      `allowing ${REACHED_SLACK} unit — so that this point is decided by what ` +
      `the core did rather than by the ship missing it; it came within ` +
      `${closest.toFixed(2)}`,
  );

  assertEqual(
    after.lives,
    START_LIVES,
    "the ship to still have all START_LIVES (" +
      `${START_LIVES}) ships after being driven into the core with its lethal ` +
      "contact test on: the core is solid but never lethal, and no life is " +
      "lost to it (specs/collision.md)",
  );

  assertEqual(
    after.screen,
    "playing",
    "the game to still be on the playing screen after the ship was driven " +
      "into the core with its lethal contact test on (specs/collision.md)",
  );
});
