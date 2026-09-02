// assets/missing-sheet-frame-leaves-game-running — an aperture frame that will
// not load leaves the game running.
//
// THE RULE, from the close of `specs/assets.md`'s "Where the files land, and how
// they are loaded": "A load that fails leaves the game running. The game still
// initializes, still ticks, still takes keyboard and pointer input, and still
// draws a legible field, tray, and tape panel when a sprite, a sheet frame, a
// system, or a sound is unavailable, so a missing file costs the game its polish
// rather than its playability." This point is the SHEET FRAME of those four.
//
// WHICH FRAME, AND WHY IT IS REACHED. The sheets are the one produced group whose
// files are chosen per frame: "Each rise and each set on the field draws frame
// `floor(state.simTime / APERTURE_FRAME_TIME) mod APERTURE_FRAMES` of its own
// sheet, centered on its anchor hex", so a build asks for all six of a sheet's
// frames and cycles through them. Frame `0` of the RISE sheet is withheld, and
// the rise `BARE`'s tray offers is placed on the field, so the withheld frame is
// one this world's own drawing reaches. `simTime` "accumulates the frame's delta
// time on every update, whatever the screen" (`specs/ui.md`), which is why no
// frame of the six can be held off the screen.
//
// THE WITHHELD NAME. A sheet's frames are "numbered from `0`", so the stem of the
// path is `0` — and under a bundler that renames a produced file while keeping
// its stem, the set sheet's own frame `0` carries the same stem. Such a build has
// two aperture frames withheld rather than one, which is still the sentence's "a
// sheet frame ... is unavailable" and reads the same way.
//
// A FILE THE BUILD NEVER REQUESTS CANNOT BE WITHHELD. A bundler is free to inline
// a small produced PNG into the bundle as a `data:` URI; that is still the
// committed file and is still conformant, and such a build makes no request to
// refuse. What this check then observes is a game that never missed anything,
// which is the honest outcome rather than a gap — the requirement is about a load
// that FAILS, and no load happened. So nothing here asserts that the load failed;
// what is asserted is what the sentence asks for either way.
//
// WHAT EACH CLAUSE IS READ AS. INITIALIZES: the surface the build installed can
// be driven at all, and a reset and one frame leave the title screen the game
// opens on. TICKS: a live run driven one whole cycle of game time has crossed one
// boundary, so `sim.cycle` reads `1` and the run is still `running`. TAKES
// KEYBOARD INPUT: `speed-up`, pressed on a live run whose step was posed at `0`,
// moves the step — "The speed actions of `specs/controls.md` move the setting one
// step and stop at `0` and at `3`" (`specs/simulation.md`). TAKES POINTER INPUT: two tray drags place two parts, which is
// the gesture `specs/editor.md` places one with. DRAWS A LEGIBLE FIELD, TRAY AND
// TAPE PANEL: each of the three regions `specs/editor.md` fixes the extents of
// answers the machine standing in it — the field draws the arm and the rise that
// were placed on it, the tray draws the rise's entry as spent ("drawn visibly
// distinct from an unspent entry"), and the tape panel draws the row the arm gave
// it — and the tray and the panel still carry their text, which is the part
// names, the costs, the row identifiers and the length annotations that
// `specs/assets.md` lists under "What stays drawn in code".
//
// THE EVIDENCE is the editor as this build drew it with the frame unavailable.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNull } from "../assert";
import { APERTURE_SHEETS } from "../constants";
import {
  captureStill,
  createHarness,
  pixelsDiffering,
  type Harness,
} from "../harness";
import { playThrough, withoutFile } from "./degraded";
import { assetFile } from "./files";

/** The sheet frame this check withholds: the rise aperture's first. */
const WITHHELD = assetFile(`${APERTURE_SHEETS.rise}/0.png`);

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ withoutAssets: withoutFile(WITHHELD) });
});

afterEach(async () => {
  await h.dispose();
});

it("initializes, ticks, reads both devices and draws all three regions", async () => {
  assertNull(
    h.surfaceFault,
    `the game still initializes with ${WITHHELD} unavailable, so its debug surface can be driven`,
  );

  const played = await playThrough(h);
  await captureStill(h, "degraded");

  assertEqual(
    played.screen,
    "title",
    "the game still initializes: a reset and one frame leave the title screen it opens on",
  );
  assertEqual(
    played.speed.before,
    0,
    "the run's speed step is posed at 0, which is what the presses move it from",
  );
  assertGreaterThan(
    played.speed.after,
    played.speed.before,
    "the game still takes keyboard input: speed-up moved the run's speed step",
  );
  assertEqual(
    played.parts.before,
    0,
    "the machine is empty before the drags, so what the drags place is all there is",
  );
  assertEqual(
    played.parts.after,
    2,
    "the game still takes pointer input: two tray drags placed the arm and the rise",
  );
  assertEqual(
    played.run.status,
    "running",
    "the game still ticks: the cycle the run was driven crossed its boundary without stopping",
  );
  assertEqual(
    played.run.cycle,
    1,
    "one whole cycle of game time crossed one boundary, so the counter reads 1",
  );

  for (const { name, region, before, after } of played.regions) {
    assertGreaterThan(
      pixelsDiffering(before, after),
      0,
      `${name} (x ${region.x} to ${region.x + region.w}, y ${region.y} to ${region.y + region.h}) still draws what the machine put in it`,
    );
  }
  assertGreaterThan(
    played.trayText.length,
    0,
    "the tray still shows each entry's name and its cost, which no produced file covers",
  );
  assertGreaterThan(
    played.tapeText.length,
    0,
    "the tape panel still shows the arm's row, its identifier and its length annotation",
  );
});
