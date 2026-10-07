// assets/gem-sprites-produced — the produced gem sprites ship with the build.
//
// specs/assets.md, "Sprites — draw", enumerates them: the seven kinds at each of
// four strain states, the `brilliant` and the `star` overlays, the `prism` at
// each of four strain states, and the board frame. Seven times four, plus two,
// plus four, plus one: thirty-five sprites, each "a single PNG per sprite",
// landed "under `public/assets/gems/`" — which the same file has Vite copy into
// the build output unchanged, so the served tree names each of them by the same
// path below `assets/`.
//
// WHAT IS READ, AND WHY IT IS THE FILES. A sprite is something the build
// PRODUCED with `draw` and committed, and the requirement here is that the art
// traces back to a produced file rather than to code. So this reads the tree on
// disk. `siteRoot()` answers with the build output, or with the committed
// `public/` when nothing has been built, and a produced file sits at the same
// path below either.
//
// WHY THE CONTENTS ARE HASHED. specs/assets.md refuses a build that "ships one
// sprite per kind with the strain states tinted in code": thirty-five files that
// are copies of eleven pictures meet a file count and not the requirement. Two
// sprites that are byte-identical are one picture, so the DISTINCT contents are
// what is counted.
//
// WHY THE COUNT IS TAKEN OVER ONE DIRECTORY. The specification fixes no file
// name below `assets/gems/`, but it does fix the layout: the sprites are landed
// "directly in `public/assets/gems/`, with each `draw-sheet` sequence in its own
// directory beside them". So the PNGs sitting directly in `assets/gems/` are the
// sprites and the subdirectories beside them are the sequences, and a recursive
// count that reached into those would let a build's break frames stand in for
// its sprites.
//
// WHAT THE ALPHA READING RULES OUT. The canvas `draw` rasterizes is transparent
// to begin with, so a file emitted without being drawn into decodes to a picture
// of nothing. A file counts as a sprite only when it decodes and at least one of
// its pixels carries alpha above the level a sampling can tell a drawing from
// channel rounding at, so whatever the build painted there counts however faint
// it is and only an undrawn file stays below.

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { it } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { assertGreaterThanOrEqual, assertNotNull, fail } from "../assert";
import { GEMS_DIR, REQUIRED_SPRITES } from "../constants";
import { mediaDestination, siteRoot } from "../harness";

/** The side of one cell of the contact sheet the check leaves as evidence. */
const CONTACT_CELL = 72;

/**
 * The alpha a pixel clears for the reading to call it painted.
 *
 * On the 0-255 alpha channel, this is the level below which a sampling cannot
 * tell a drawing from eight-bit channel rounding and the rasterizer's
 * antialiasing. Anything the build painted into the canvas clears it, at
 * whatever opacity, so a sprite drawn wholly translucent reads the same as one
 * drawn solid and only a file that was never drawn into stays below.
 */
const ALPHA_FLOOR = 8;

/** One produced picture, with the digest that tells it apart from another. */
interface Sprite {
  path: string;
  hash: string;
}

/** The PNG files directly in `dir`, in name order. */
function pngsIn(dir: string): string[] {
  return readdirSync(dir)
    .filter((entry) => entry.toLowerCase().endsWith(".png"))
    .sort()
    .map((entry) => join(dir, entry))
    .filter((path) => statSync(path).isFile());
}

/**
 * The sprite a file holds, or `null` when it holds none.
 *
 * A file that does not decode as an image, or that decodes to a picture with no
 * pixel anywhere in it clearing {@link ALPHA_FLOOR}, is not a produced sprite
 * however it was named.
 */
async function readSprite(path: string): Promise<Sprite | null> {
  const bytes = readFileSync(path);
  let pixels: Uint8ClampedArray;
  try {
    const image = await loadImage(bytes);
    if (image.width < 1 || image.height < 1) return null;
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    pixels = context.getImageData(0, 0, image.width, image.height).data;
  } catch {
    return null;
  }
  for (let at = 3; at < pixels.length; at += 4) {
    if (pixels[at] > ALPHA_FLOOR) {
      return { path, hash: createHash("sha256").update(bytes).digest("hex") };
    }
  }
  return null;
}

/** The distinct sprites `dir` itself holds, one entry per distinct picture. */
async function spritesIn(dir: string): Promise<Sprite[]> {
  const byHash = new Map<string, Sprite>();
  for (const path of pngsIn(dir)) {
    const sprite = await readSprite(path);
    if (sprite !== null && !byHash.has(sprite.hash)) {
      byHash.set(sprite.hash, sprite);
    }
  }
  return [...byHash.values()];
}

/**
 * A contact sheet of the sprites the check counted, as the item's evidence.
 *
 * Each picture is fitted into a square cell at its own aspect, so the board
 * frame sits beside a gem without either being distorted, on a mid gray a light
 * sprite and a dark one both read against. Evidence only: nothing here decides
 * the verdict, and a sheet that cannot be written is reported and swallowed.
 */
async function writeContactSheet(
  outputId: string,
  sprites: readonly Sprite[],
): Promise<void> {
  const destination = mediaDestination(outputId, "png");
  if (destination === null || sprites.length === 0) return;
  const columns = Math.ceil(Math.sqrt(sprites.length));
  const rows = Math.ceil(sprites.length / columns);
  try {
    const canvas = createCanvas(columns * CONTACT_CELL, rows * CONTACT_CELL);
    const context = canvas.getContext("2d");
    context.fillStyle = "#3a3a3f";
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (const [index, sprite] of sprites.entries()) {
      const image = await loadImage(readFileSync(sprite.path));
      const scale = Math.min(
        CONTACT_CELL / image.width,
        CONTACT_CELL / image.height,
      );
      const width = image.width * scale;
      const height = image.height * scale;
      context.drawImage(
        image,
        (index % columns) * CONTACT_CELL + (CONTACT_CELL - width) / 2,
        Math.floor(index / columns) * CONTACT_CELL +
          (CONTACT_CELL - height) / 2,
        width,
        height,
      );
    }
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, canvas.toBuffer("image/png"));
  } catch (error) {
    console.warn(`facet: could not write ${destination}: ${String(error)}`);
  }
}

it("ships at least thirty-five distinct produced gem sprites", async () => {
  const root = siteRoot();
  assertNotNull(root, "the built site, or the committed public/ tree");
  const gems = join(root as string, ...GEMS_DIR);
  if (!existsSync(gems)) {
    fail(`a produced ${GEMS_DIR.join("/")}/ directory under ${root}`, "absent");
  }

  // The PNGs sitting directly in `assets/gems/`, which is where specs/assets.md
  // lands the sprites; the sequence directories beside them hold frames rather
  // than sprites and are never reached into.
  const sprites = await spritesIn(gems);
  sprites.sort((a, b) => a.path.localeCompare(b.path));
  await writeContactSheet("sprites", sprites);

  assertGreaterThanOrEqual(
    sprites.length,
    REQUIRED_SPRITES,
    "distinct produced PNG sprites, each decoding with painted pixels, " +
      "directly in assets/gems/",
  );
});
