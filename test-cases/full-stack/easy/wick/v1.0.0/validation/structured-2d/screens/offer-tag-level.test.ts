// Wick — screens/offer-tag-level: an offer for something already held is
// tagged with the level it would become.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE. `specs/ui.md`, "`levelup`", the
// offer table: the Tag is "`OFFER_NEW_TEXT` (`NEW`) for an item not yet held,
// else `LEVEL_LABEL` and the level it would become, as `LEVEL 3`."
// `specs/progression.md`, "Choosing", states the same rule, and the same file
// makes a held base weapon below `MAX_WEAPON_LEVEL` (`8`) a candidate "as a
// `+1 level` offer". Taper held at level `HELD_LEVEL` (`3`) would become
// level `4`, so the tag reads `LEVEL 4`.
//
// THE DRIVE. An isolated `playing` run with Taper posed into the first weapon
// slot at level `3` and nothing else held, every driver switch off; Taper
// queued as the single offer through `setNextOffers`, which
// `specs/instrumentation.md` accepts because a held weapon below its maximum
// is a candidate; and the one `playing` tick that opens the overlay.
//
// WHY THE RUN'S OWN LEVEL CANNOT BE MISTAKEN FOR THE TAG'S. The HUD draws
// `LEVEL_LABEL` beside the lamplighter's level too (`specs/ui.md`, `playing`),
// and the isolation leaves that level at the idle run's `1`, which cannot be
// read as the tag's `4`.
//
// THE TOLERANCE. The tag is matched as `LEVEL_LABEL` followed by the level,
// with any run of spaces between them and ignoring case, which is the form
// `specs/ui.md` spells (`LEVEL 3`); the digits must stand as their own token,
// so a HUD reading `LEVEL 50` is not mistaken for it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertTrue } from "../assert";
import { LEVEL_LABEL, MAX_WEAPON_LEVEL } from "../constants";
import {
  captureStill,
  createHarness,
  drawnText,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

/** The level Taper is held at, below MAX_WEAPON_LEVEL so it is a candidate. */
const HELD_LEVEL = 3;
/** The level the offer would take it to. */
const OFFERED_LEVEL = HELD_LEVEL + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("tags a held Taper's offer with the level it would become", async () => {
  if (!(HELD_LEVEL < MAX_WEAPON_LEVEL)) {
    throw new Error("the held level must leave the weapon a candidate");
  }

  isolate(h);
  h.debug.setWeapon(0, "taper", HELD_LEVEL);
  h.debug.setNextOffers(["taper"]);
  const overlay = await openLevelUp(h, 1);
  assertEqual(overlay.screen, "levelup", "the screen the frame is read on");
  assertDeepEqual(
    overlay.run.offers,
    ["taper"],
    "the offers the overlay presents",
  );
  assertEqual(
    overlay.run.weapons[0].level,
    HELD_LEVEL,
    "the level Taper is held at",
  );

  const { calls } = await h.frameDraw();
  captureStill(h, "level");

  const tag = new RegExp(`${LEVEL_LABEL}\\s*${OFFERED_LEVEL}(?![\\w])`, "i");
  assertTrue(
    drawnText(calls).some((line) => tag.test(line)),
    `a run of text reading ${LEVEL_LABEL} ${OFFERED_LEVEL}, the level the offer would give Taper (specs/ui.md, levelup)`,
  );
});
