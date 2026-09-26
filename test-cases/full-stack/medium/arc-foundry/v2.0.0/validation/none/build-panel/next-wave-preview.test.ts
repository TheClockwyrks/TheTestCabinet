// build-panel/next-wave-preview — the panel previews the wave that is coming.
//
// `specs/hud.md`: "with nothing selected, the panel shows the coming wave's unit
// types". `specs/enemies.md` fixes what those types may be: "waves `1` through
// `3` carry Motes and Sparks only", and "a wave whose number is a multiple of `4`
// carries Filaments. No other wave carries a Filament."
//
// So the preview is read in two build phases whose coming wave the specification
// pins down. `specs/campaign.md` opens a run with the wave counter at `0`, and
// the harvest of a build phase launches the next wave, so the counter at `0`
// precedes wave `1` and the counter at `3` precedes wave `4`. Before wave `1` the
// preview may name Motes and Sparks and must name nothing else; before wave `4`
// it must name the Filament, which is the change as the run deepens.
//
// What is read is the panel's text, because a type a player cannot read the name
// of is not a preview of anything.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  drew,
  type Harness,
  openYard,
  PANEL,
} from "../harness";
import { LOAD_TYPES } from "../constants";

/** The only types specs/enemies.md lets waves 1 through 3 carry. */
const OPENING = ["mote", "spark"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("names only Motes and Sparks before wave 1, and the Filament before wave 4", async () => {
  await openYard(h, { wave: 0 });
  await h.debug.clearSelection();

  const opening = await h.frameCalls();
  assertEqual(
    OPENING.some((type) => drew(opening, PANEL, type)),
    true,
    "whether the preview names either of the two types wave 1 may carry",
  );
  for (const type of LOAD_TYPES.filter((t) => !OPENING.includes(t))) {
    assertEqual(
      drew(opening, PANEL, type),
      false,
      `whether the preview names the ${type} before wave 1, which ` +
        "specs/enemies.md keeps out of waves 1 to 3",
    );
  }

  await h.debug.setWave(3);
  await h.debug.clearSelection();
  const deeper = await h.frameCalls();
  await captureStill(h, "preview");
  assertEqual(
    drew(deeper, PANEL, "filament"),
    true,
    "whether the preview names the Filament before wave 4, which " +
      "specs/enemies.md gives Filaments",
  );
});
