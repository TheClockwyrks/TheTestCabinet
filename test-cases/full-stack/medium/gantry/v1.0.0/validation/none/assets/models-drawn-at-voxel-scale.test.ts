// assets/models-drawn-at-voxel-scale — a model is drawn at one unit per
// `VOXELS_PER_UNIT` of the size it was sculpted at.
//
// `specs/assets.md` § The models fixes the scale a produced model is drawn at:
// the files are sculpted in voxels, and the game draws them at
// `1 / VOXELS_PER_UNIT` (`8`) of that. So a model sculpted twenty voxels wide is
// drawn two and a half units wide, and one drawn at the file's own units would
// stand eight times too large over a yard measured in the same units the lattice
// is.
//
// TWO READINGS, EACH OF THE BUILD'S OWN WORK. The file's extent is measured from
// the committed `.glb` — a FILE read of what the build produced, never anything
// on screen — and the drawn extent is what `drawn()` reports the frame covered
// (`specs/instrumentation.md`). The requirement is the ratio between them.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertTrue } from "../assert";
import { VOXELS_PER_UNIT } from "../constants";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { meshExtent } from "../glb";
import {
  addOneLoad,
  clearAll,
  createHarness,
  entriesOf,
  openSite,
  type Harness,
} from "../harness";

/** The build's own tree: the validator project is staged inside it. */
const WORKSPACE = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** The subject: a load class, so one `addLoad` puts it in the yard. */
const CLASS = "crate" as const;
const MASS = 40;
const FROM = { x: 7, y: 0, z: -3, yaw: 0 };
const TO = { x: -6, y: 0, z: 8, yaw: 0 };

/**
 * How far the drawn size may fall from the sculpted size over
 * `VOXELS_PER_UNIT`, as a share of it. A build is free to centre or pad its own
 * geometry a little; what it is not free to do is draw at the file's own units.
 */
const TOLERANCE_SHARE = 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a produced model at one unit per VOXELS_PER_UNIT of its sculpt", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setScreen("build");
  await addOneLoad(h, CLASS, MASS, FROM, TO);
  await h.advance(1);

  const models = entriesOf(await h.drawn(), "model", CLASS);

  await h.capture("scale", "The load's model, drawn at voxel scale");

  assertTrue(
    models.length > 0,
    `a \`${CLASS}\` model among what the frame drew`,
  );

  const sculpted = meshExtent(
    join(WORKSPACE, "assets", "models", `${CLASS}.glb`),
    CLASS,
  );
  const drawn = models[0]!.size;
  const axes: readonly [string, number, number][] = [
    ["x", sculpted.x, drawn[0]],
    ["y", sculpted.y, drawn[1]],
    ["z", sculpted.z, drawn[2]],
  ];
  for (const [axis, voxels, units] of axes) {
    const wanted = voxels / VOXELS_PER_UNIT;
    assertCloseTo(
      units,
      wanted,
      Math.max(wanted * TOLERANCE_SHARE, 0.05),
      `the model's drawn ${axis} against ${voxels} voxels over ` +
        `VOXELS_PER_UNIT (${VOXELS_PER_UNIT}) — specs/assets.md`,
    );
  }
});
