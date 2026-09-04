// visibility/shield-absent-while-inactive — no shield, no ring at radius 92.
//
// WHAT THE SPECIFICATION FIXES. `specs/field.md` makes the shield ring a
// circle "present while the shield is active", and the review item reads the
// other direction of that sentence: "With no shield active no shield ring is
// drawn, so a player never reads protection that is not there."
//
// THE WORLD THIS POSES. An isolated `playing` field and nothing more: `reset`
// restores the boot state, so no shield is active — the snapshot's
// `effects.shieldActive` confirms it — and one tick renders the field.
//
// WHERE IT SAMPLES, AND THE TOLERANCE. The shared shield band (see
// `visibility/shield-band.ts`): twenty angle columns around the four
// cardinals, each a radial window over 86 to 98 held against the open field
// at the same angle. A drawn ring separates essentially every column — that
// is what the presence point reads — while a field with no ring separates
// none of them, except where a speck of the build's own starfield happens to
// sit inside the sampled band. So the read is a COUNT: no more than
// `ABSENCE_MAX_COLUMNS` (4) of the twenty columns may stand clearly apart
// (`DISTINCT_MIN`, see `visibility/distinct.ts`), which tolerates stray
// specks and still fails any arc coherent enough to read protection off.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { captureStill, isolate, openHarness, type Harness } from "../harness";
import { ABSENCE_MAX_COLUMNS, DISTINCT_MIN } from "./distinct";
import { shieldBandColumns } from "./shield-band";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws no shield ring while no shield is active", async () => {
  const posed = await isolate(h);
  assertEqual(
    posed.effects.shieldActive,
    false,
    "the posed field's shield, inactive after a reset",
  );
  await h.tick(1);
  await captureStill(h, "shield-inactive");

  const columns = await shieldBandColumns(h);
  const apart = columns.filter((column) => column > DISTINCT_MIN).length;

  assertLessThanOrEqual(
    apart,
    ABSENCE_MAX_COLUMNS,
    "the sampled columns of the radius-92 band standing apart from the " +
      "field with no shield active",
  );
});
