// Wick — evolutions/blaze-fires-alone: Blaze fires with no enemy alive.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Blaze"): "Blaze fires
// whether or not any enemy exists." `BLAZE_STATS` gives amount `5`, and
// `amountBonus` is `0` with no Mirror held (`specs/passives.md`). So on the tick
// Blaze's timer is due over an empty night, five zones of kind `puddle` and
// weapon `blaze` are created.
//
// THE POSE. An isolated night with nothing alive — no spawn, no event, no
// motion — and Blaze held at level 1 and its due tick run through the shared
// `fireWeapon`. The zones created on the tick are the entries whose id is at
// least the `nextId` the tick started from.
//
// TOLERANCE. None: the count is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  type Harness,
} from "../harness";
import { zonesFired } from "./stage";

/** Blaze's fixed amount, `5`. */
const AMOUNT = weaponRow("blaze").amount as number;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates five Blaze puddles on the due tick with no enemy alive", async () => {
  await isolate(h);
  const opened = await h.snapshot();
  assertEqual(
    opened.run.enemies.length,
    0,
    "enemies alive on the isolated night",
  );

  const firing = await fireWeapon(h, "blaze", 1);
  await captureStill(h, "alone");

  assertEqual(
    zonesFired(firing, "blaze", "puddle").length,
    AMOUNT,
    "Blaze puddles the due tick created with no enemy alive",
  );
});
