// assets/missing-sprite-leaves-game-running — a mote sprite that will not load
// leaves the game running.
//
// THE RULE, from the close of `specs/assets.md`'s "Where the files land, and how
// they are loaded": "A load that fails leaves the game running. The game still
// initializes, still ticks, still takes keyboard and pointer input, and still
// draws a legible field, tray, and tape panel when a sprite, a sheet frame, a
// system, or a sound is unavailable, so a missing file costs the game its polish
// rather than its playability." This point is the SPRITE of those four; the sheet
// frame, the system and the sound are the three points beside it.
//
// WHICH SPRITE, AND WHY IT IS A MOTE'S. `specs/assets.md` draws a mote sprite
// "centered on every mote's position, at rest and while carried, upright at every
// moment of a cycle" — the one sprite the field cannot get through a frame
// without, on the fifteen files that are the largest group in the table. `sol` is
// the type `BARE`'s reagent and product are, so it is the mote this world would
// put on the field.
//
// A FILE THE BUILD NEVER REQUESTS CANNOT BE WITHHELD. A bundler is free to inline
// a small produced PNG into the bundle as a `data:` URI; that is still the
// committed file and is still conformant, and such a build simply makes no
// request to refuse. What this check then observes is a game that never missed
// anything, which is the honest outcome rather than a gap — the requirement is
// about a load that FAILS, and no load happened. So nothing here asserts that the
// load failed; what is asserted is what the sentence asks for either way.
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
// THE EVIDENCE is the editor as this build drew it with the sprite unavailable.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNull } from "../assert";
import { MOTE_SPRITE_PATHS } from "../constants";
import {
  captureStill,
  createHarness,
  pixelsDiffering,
  type Harness,
} from "../harness";
import { playThrough, withoutFile } from "./degraded";
import { assetFile } from "./files";

/** The mote sprite this check withholds: the type `BARE` rises and sets. */
const WITHHELD = assetFile(MOTE_SPRITE_PATHS.sol);

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
