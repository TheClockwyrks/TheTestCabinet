// assets/missing-sound-leaves-game-running — a cue file that will not load leaves
// the game running.
//
// THE RULE, from the close of `specs/assets.md`'s "Where the files land, and how
// they are loaded": "A load that fails leaves the game running. The game still
// initializes, still ticks, still takes keyboard and pointer input, and still
// draws a legible field, tray, and tape panel when a sprite, a sheet frame, a
// system, or a sound is unavailable, so a missing file costs the game its polish
// rather than its playability." This point is the SOUND of those four.
//
// WHICH CUE, AND WHY IT IS `place`. `specs/assets.md` requires every cue "bound
// to its cue before the first frame draws", so a cue whose file will not decode
// is a binding that fails while the game is standing up — the moment the sentence
// is about. `place` is the cue this world would actually sound: it "fires many
// times a minute while a machine is built", and the two tray drags below are two
// placements, so a build that faults on playing an unbound cue faults here rather
// than staying silent.
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
// WHAT THIS POINT DOES NOT READ. Whether the cue is silent. The sentence costs
// the game "its polish rather than its playability", and the polish is exactly
// what a missing file is allowed to take; what is read here is that everything
// else is still there.
//
// THE EVIDENCE is the editor as this build drew it with the cue unavailable.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNull } from "../assert";
import { CUE_PATHS, CUES } from "../constants";
import {
  captureStill,
  createHarness,
  pixelsDiffering,
  type Harness,
} from "../harness";
import { playThrough, withoutFile } from "./degraded";
import { assetFile } from "./files";

/** The cue file this check withholds: the one a placement sounds. */
const WITHHELD = assetFile(CUE_PATHS[CUES.place]);

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
