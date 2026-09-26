// firing/tallies-kills — a structure counts the units it killed.
//
// `specs/components.md`: "Every firing structure keeps two running tallies for
// the run: the number of units it killed, and the total damage it dealt." This
// point decides the first. `specs/hud.md` is what it is for — the inspector's
// read and the damage leaderboard's ranking — so a build that never increments it
// ranks every tower at zero kills.
//
// THE DAMAGE TALLY IS THE SIBLING POINT `firing/tallies-damage`. The two are
// independent counters and a build can keep one and not the other, so the yard
// they share is posed in `tally.ts` and each is read by name.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { createHarness, type Harness } from "../harness";
import { PLACES, TALLY_HZ, clearsThreeMotes } from "./tally";

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ hz: TALLY_HZ });
});

afterEach(() => {
  h.dispose();
});

it("tallies one kill for each unit it killed", async () => {
  const after = await clearsThreeMotes(h, "kills");
  assertEqual(
    after.kills,
    PLACES.length,
    "the structure's kill tally after killing every unit on the yard " +
      "(specs/components.md)",
  );
});
