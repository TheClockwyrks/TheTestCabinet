// hud/health-numbers-drawn — the health readout draws hp and maxHp.
//
// WHERE THE FIGURES COME FROM. specs/ui.md ("`playing`", the HUD table):
// "Health | A bar whose filled width scales with `hp / maxHp`, with both
// numbers beside it, `hp` rounded up to a whole number." specs/passives.md:
// "`maxHp` is `BASE_MAX_HP` (`100`) plus `TALLOW_HP_PER_LEVEL` per Tallow
// level", with `TALLOW_HP_PER_LEVEL` `15`, so one level of Tallow makes
// `maxHp` 115. hp is posed to 73, a whole number, so the number the frame owes
// is 73 whatever a build rounds.
//
// THE WORLD. An isolated `playing` run: nothing alive, nothing on the ground,
// no weapon held, every driver switch off, with Tallow the only passive so the
// pair of numbers is 73 and 115 rather than 100 and 100, which no other readout
// on the frame can be mistaken for. `setPassive` leaves `hp` untouched
// (specs/instrumentation.md), so hp is posed after it. Recovery is
// `BASE_RECOVERY` (`0`) with no Tinder held (specs/passives.md), so the tick
// the frame runs leaves hp where it was posed.
//
// WHAT IS READ. Every run of text the frame drew, and whether 73 and 115 each
// appear in one as a whole number rather than inside a longer digit run.
// specs/ui.md fixes no font and no layout, so the reading is of the numbers and
// not of the shape a build sets them in or the separator it puts between them.
//
// TOLERANCE. None: both figures are whole numbers, and a run of text either
// holds one or does not.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertWithin, fail } from "../assert";
import {
  BASE_MAX_HP,
  FIGURE_TOLERANCE,
  TALLOW_HP_PER_LEVEL,
} from "../constants";
import {
  captureStill,
  createHarness,
  hasToken,
  holdPassive,
  isolate,
  textReadings,
  type Harness,
} from "../harness";

/** `maxHp` with one level of Tallow held: 100 + 15. */
const MAX_HP = BASE_MAX_HP + TALLOW_HP_PER_LEVEL;

/** The hp posed, a whole number well inside `maxHp`. */
const HP = 73;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws 73 and 115 at hp 73 of maxHp 115", async () => {
  isolate(h);
  holdPassive(h, "tallow", 1);
  const posed = h.snapshot();
  assertLength(posed.run.passives, 1, "passives held, Tallow alone");
  assertWithin(
    posed.run.maxHp,
    MAX_HP,
    FIGURE_TOLERANCE,
    "maxHp with one level of Tallow held",
  );
  h.debug.setHp(HP);

  const { calls } = await h.frameDraw();
  captureStill(h, "numbers");

  // The raw calls and the logical runs they spell, both: a figure drawn a
  // glyph per call is read as the number it is off the runs, and one drawn a
  // narrow gap after its label, which the run rule merges into `HP73`, still
  // stands alone as the raw call.
  const drawn = textReadings(calls);
  const after = h.snapshot();
  assertWithin(
    after.run.player.hp,
    HP,
    FIGURE_TOLERANCE,
    "hp on the tick the frame drew",
  );
  if (!hasToken(drawn, String(HP))) {
    fail(`a run of text holding the whole number ${HP} (hp)`, drawn);
  }
  if (!hasToken(drawn, String(MAX_HP))) {
    fail(`a run of text holding the whole number ${MAX_HP} (maxHp)`, drawn);
  }
});
