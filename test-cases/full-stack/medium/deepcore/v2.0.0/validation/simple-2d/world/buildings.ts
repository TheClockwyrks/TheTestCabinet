// Deepcore — the camp's footprints, for the checks that are about them.
// CASE-PROVIDED.
//
// Not a `.test.ts`, so vitest never collects it.
//
// `specs/world.md` names six buildings on the camp ground and `buildings()`
// reports one footprint per building. Two points read those footprints —
// `world/buildings-separated` and `world/buildings-clear-of-the-cave-mouth` — so
// the opening and the lookup they share are built once, here, out of the atomic
// operations, and a building the build never reported fails the point that
// reached for it naming which one.

import { BUILDINGS } from "../constants";
import { fail } from "../assert";
import {
  layCamp,
  openScene,
  pinDrill,
  standAtCamp,
  type BuildingBox,
  type Harness,
} from "../harness";

/**
 * Open the camp and read the six footprints the build reports for it, in the
 * order `specs/world.md` lists them.
 *
 * Two frames, which is what puts the camp the scene laid in the build's hand
 * before anything is read off it.
 */
export async function campFootprints(h: Harness): Promise<BuildingBox[]> {
  openScene(h);
  layCamp(h);
  standAtCamp(h);
  pinDrill(h);
  await h.advance(2);

  const reported = h.debug.buildings();
  return BUILDINGS.map((id) => {
    const box = reported.find((entry) => entry.id === id);
    if (box === undefined) {
      fail(
        `a footprint for the "${id}" specs/world.md names`,
        `buildings() reported ${reported.length === 0 ? "none" : reported.map((b) => b.id).join(", ")}`,
      );
    }
    return box;
  });
}
