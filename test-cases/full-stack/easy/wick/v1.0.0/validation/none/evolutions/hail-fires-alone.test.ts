// Wick — evolutions/hail-fires-alone: Hail fires with no enemy alive.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Hail"): a dart is
// "fired whether or not any enemy exists". `HAIL_STATS` gives amount `6`, and
// `amountBonus` is `0` with no Mirror held (`specs/passives.md`). So on the tick
// Hail's timer is due over an empty night, six projectiles of weapon `hail` are
// created.
//
// THE POSE. An isolated night with nothing alive — no spawn, no event, no
// motion — and Hail held at level 1 and its due tick run through the shared
// `fireWeapon`. The projectiles created on the tick are the entries whose id is
// at least the `nextId` the tick started from.
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
import { boltsFired } from "./stage";

/** Hail's fixed amount, `6`. */
const AMOUNT = weaponRow("hail").amount as number;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates six Hail darts on the due tick with no enemy alive", async () => {
  await isolate(h);
  const opened = await h.snapshot();
  assertEqual(
    opened.run.enemies.length,
    0,
    "enemies alive on the isolated night",
  );

  const firing = await fireWeapon(h, "hail", 1);
  await captureStill(h, "alone");

  assertEqual(
    boltsFired(firing, "hail").length,
    AMOUNT,
    "Hail darts the due tick created with no enemy alive",
  );
});
