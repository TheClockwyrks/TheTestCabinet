// instrumentation/set-next-crit-arms — `setNextCrit` arms one structure's next
// shot, and the snapshot reads the arming back.
//
// `specs/instrumentation.md`: "Arms the outcome of the crit roll on the next shot
// a structure carrying `crit` launches: `true` lands the crit and `false` lands an
// ordinary hit", "reported as that structure's `nextCrit`, `null` once consumed or
// cleared", and `null` "on every structure carrying no arming". Two Slag Drivers
// stand on the yard; one is armed each way in turn and both are read, so an
// arming that lands on the wrong structure, or on every structure, shows.
//
// NO SHOT IS FIRED. Nothing is in range, so what is read is the arming alone;
// `instrumentation/next-crit-consumed-by-the-shot` is where a shot consumes it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { comboDef } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  standCombo,
  structureById,
  type Harness,
} from "../harness";

const TOWER = comboDef("slagdriver");

/** Two anchors clear of the Substation's chain and of each other. */
const ARMED_AT = { col: 12, row: 12 };
const OTHER_AT = { col: 20, row: 12 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads back as the armed structure's nextCrit, and nobody else's", async () => {
  openYard(h);
  const armed = standCombo(h, TOWER.id, ARMED_AT.col, ARMED_AT.row);
  const other = standCombo(h, TOWER.id, OTHER_AT.col, OTHER_AT.row);

  const unarmed = h.snapshot();
  assertNull(
    structureById(unarmed, armed).nextCrit,
    "a fresh structure's nextCrit, before anything is armed",
  );

  h.debug.setNextCrit(armed, true);
  await h.advance(1);
  captureStill(h, "armed");
  const landing = h.snapshot();
  assertEqual(
    structureById(landing, armed).nextCrit,
    true,
    "nextCrit after setNextCrit(id, true) (specs/instrumentation.md)",
  );
  assertNull(
    structureById(landing, other).nextCrit,
    "the other structure's nextCrit, which the arming leaves alone",
  );

  h.debug.setNextCrit(armed, false);
  const missing = h.snapshot();
  assertEqual(
    structureById(missing, armed).nextCrit,
    false,
    "nextCrit after setNextCrit(id, false), which replaces the arming",
  );
  assertNull(
    structureById(missing, other).nextCrit,
    "the other structure's nextCrit, still unarmed",
  );
});
