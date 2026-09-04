// firing/tallies-damage — a structure totals the damage it dealt.
//
// `specs/components.md`: "Every firing structure keeps two running tallies for
// the run: the number of units it killed, and the total damage it dealt." This
// point decides the second. `specs/hud.md` is what it is for — the damage
// leaderboard ranks on this figure — so a build that counts kills and totals no
// damage ranks its towers by the wrong thing entirely.
//
// THE KILL TALLY IS THE SIBLING POINT `firing/tallies-kills`. The two are
// independent counters and a build can keep one and not the other, so the yard
// they share is posed in `tally.ts` and each is read by name.
//
// THE ARRANGEMENT LEAVES NOTHING SPILLED: each Mote takes whole shots, so the
// health the structure removed is exactly the damage the tally should carry.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { createHarness, type Harness } from "../harness";
import { MOTE_HP, PLACES, clearsThreeMotes } from "./tally";
import { componentDamage } from "../constants";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("totals the health it removed as the damage it dealt", async () => {
  const after = await clearsThreeMotes(h, "damage");
  assertCloseTo(
    after.damageDealt,
    PLACES.length * MOTE_HP,
    6,
    `the structure's damage tally: ${PLACES.length} Motes of ${MOTE_HP} health, ` +
      `each taking whole ${componentDamage("emitter", 1)}-damage shots with ` +
      `nothing spilled (specs/components.md)`,
  );
});
