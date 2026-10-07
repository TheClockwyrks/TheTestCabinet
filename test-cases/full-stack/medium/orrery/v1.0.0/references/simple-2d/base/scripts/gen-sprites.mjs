// Orrery — produce every sprite and both sheets the game draws, with the
// on-PATH `draw` and `draw-sheet` tools (specs/assets.md "The sprites" and
// "The sheets").
//
// The look is A BRASS INSTRUMENT UNDER A NIGHT SKY: worked metal, cut glass,
// and the cold light of the bodies the machine handles. The machine is brass
// in one warm ramp; the motes alone carry saturated color, because they are
// the light in the scene; and nothing here is painted on a ground, because
// every one of these composites over the field the build draws in code.
//
// Production is a ONE-TIME step. The finished PNGs land under `assets/` and
// are committed; neither `npm ci` nor `npm run build` runs this, and the built
// site fetches nothing from outside its own `dist/`. Each sprite is composed
// as a pixel raster under `scripts/sprites/` and handed to the tool as the
// recorded operations that reproduce it, so the committed file is the tool's
// own render of its own action log. `ASSET-LAYOUT.md` maps every file this
// writes.
//
// Produces, at the exact paths specs/assets.md lists (45 stills + 12 frames):
//   assets/sprites/motes/<type>.png         draw, 44x44, fifteen of them
//   assets/sprites/filaments/plain.png      draw, 48x16
//   assets/sprites/filaments/triune.png     draw, 48x16
//   assets/sprites/sigils/<kind>.png        draw, 48x48, twelve of them
//   assets/sprites/instructions/<name>.png  draw, 24x24, ten of them
//   assets/sprites/parts/hub-arm.png        draw, 40x40
//   assets/sprites/parts/hub-piston.png     draw, 40x40
//   assets/sprites/parts/gripper-open.png   draw, 32x32
//   assets/sprites/parts/gripper-closed.png draw, 32x32
//   assets/sprites/parts/wheel-hub.png      draw, 48x48
//   assets/sprites/parts/fixture-mount.png  draw, 48x48
//   assets/sprites/apertures/rise/{0..5}.png  draw-sheet, 6 frames of 48x48
//   assets/sprites/apertures/set/{0..5}.png   draw-sheet, 6 frames of 48x48
//
// Usage:  node scripts/gen-sprites.mjs [out-dir]
//   `draw` and `draw-sheet` must be on the PATH, or built under
//   `$CARGO_TARGET_DIR` (`/cargo-target/the-test-cabinet` by default).
//   `out-dir` defaults to `assets/` beside `scripts/`.

import console from "node:console";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { FRAMES, RISE, SET, STEP } from "./sprites/apertures.mjs";
import { plain, triune } from "./sprites/filaments.mjs";
import { NAMES, paintInstruction } from "./sprites/instructions.mjs";
import { MOTES, paintMote } from "./sprites/motes.mjs";
import {
  fixtureMount,
  gripperClosed,
  gripperOpen,
  hubArm,
  hubPiston,
  wheelHub,
} from "./sprites/parts.mjs";
import { drawSheet, drawSprite, openTools } from "./sprites/raster.mjs";
import { KINDS, paintSigil } from "./sprites/sigils.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.resolve(process.argv[2] ?? path.join(ROOT, "assets"));

/** The fifteen motes, one PNG each, at the paths `MOTE_SPRITE_PATHS` names. */
function produceMotes(tools) {
  for (const type of Object.keys(MOTES)) {
    drawSprite(
      tools,
      path.join(out, `sprites/motes/${type}.png`),
      paintMote(type),
    );
  }
}

/** Both filament strips. */
function produceFilaments(tools) {
  drawSprite(tools, path.join(out, "sprites/filaments/plain.png"), plain());
  drawSprite(tools, path.join(out, "sprites/filaments/triune.png"), triune());
}

/** The twelve transforming sigils' engraved glyphs. */
function produceSigils(tools) {
  for (const kind of KINDS) {
    drawSprite(
      tools,
      path.join(out, `sprites/sigils/${kind}.png`),
      paintSigil(kind),
    );
  }
}

/** The ten instruction glyphs a tape cell shows. */
function produceInstructions(tools) {
  for (const name of NAMES) {
    drawSprite(
      tools,
      path.join(out, `sprites/instructions/${name}.png`),
      paintInstruction(name),
    );
  }
}

/** The hubs, the grippers, the wheel hub, and the fixture mount. */
function produceParts(tools) {
  const pieces = [
    ["hub-arm", hubArm],
    ["hub-piston", hubPiston],
    ["gripper-open", gripperOpen],
    ["gripper-closed", gripperClosed],
    ["wheel-hub", wheelHub],
    ["fixture-mount", fixtureMount],
  ];
  for (const [name, paint] of pieces) {
    drawSprite(tools, path.join(out, `sprites/parts/${name}.png`), paint());
  }
}

/**
 * One aperture sheet: the blade ring and the iris registered as sheet-wide
 * layers, then keyed to counter-rotate across the six frames. Each frame
 * advances STEP degrees and the motifs are six-fold symmetric, so the sheet
 * closes on itself between frame 5 and frame 0.
 */
function produceAperture(tools, name, sheetSpec) {
  drawSheet(
    tools,
    path.join(out, `sprites/apertures/${name}`),
    48,
    48,
    FRAMES,
    (s) => {
      s.layer("blades", sheetSpec.blades(), { z: 0 });
      s.layer("iris", sheetSpec.iris(), { z: 1 });
      const last = FRAMES - 1;
      const sweep = STEP * last;
      s.key("blades", "rotation", 0, 0);
      s.key("blades", "rotation", last, sheetSpec.bladeTurn * sweep);
      s.key("iris", "rotation", 0, 0);
      s.key("iris", "rotation", last, -sheetSpec.bladeTurn * sweep);
    },
  );
}

/** Both aperture sheets, twelve numbered frames in all. */
function produceApertures(tools) {
  produceAperture(tools, "rise", RISE);
  produceAperture(tools, "set", SET);
}

// The tools write their logs and previews where the config points, so every
// intermediate file goes to a scratch directory that is removed at the end and
// only the finished PNGs land under `out`.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "orrery-sprites-"));
const started = Date.now();
try {
  const tools = openTools(scratch);
  const groups = [
    ["the fifteen motes", produceMotes],
    ["the two filament strips", produceFilaments],
    ["the twelve sigil glyphs", produceSigils],
    ["the ten instruction glyphs", produceInstructions],
    ["the machine's pieces", produceParts],
    ["the two aperture sheets", produceApertures],
  ];
  for (const [label, produce] of groups) {
    const before = tools.files;
    produce(tools, out);
    console.log(`${label}: ${tools.files - before} files`);
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `produced ${tools.files} files from ${tools.operations} tool operations in ${seconds}s under ${out}`,
  );
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
