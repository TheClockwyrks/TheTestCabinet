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
// WHY THE COUNT IS TAKEN PER DIRECTORY. The specification fixes no file name and
// no directory name below `assets/gems/`; it says only that the sprites land
// there, and that each `draw-sheet` sequence lands "under its own directory". A
// recursive count over the whole of `assets/gems/` would therefore let a build's
// break frames stand in for its sprites, and a count of one hard-coded directory
// would fail a build that grouped its sprites under a name of its own. So each
// directory below `assets/gems/` is counted on its own and the largest count is
// the reading: the sprites are wherever the build put them together, and a
// sequence's frames are counted apart from them.
//
// WHAT "CARRYING OPAQUE PIXELS" RULES OUT. The canvas `draw` rasterizes is
// transparent to begin with, so a file emitted without being drawn into decodes
// to a picture of nothing. A file counts as a sprite only when it decodes and at
// least one of its pixels is fully opaque.

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
import { mediaDestination, siteRoot } from "../harness";

/**
 * How many distinct sprites specs/assets.md's four bullets ask for.
 *
 * Seven kinds at each of four strain states, the two cut overlays, the prism at
 * each of the same four strain states, and the one board frame.
 */
const REQUIRED_SPRITES = 7 * 4 + 2 + 4 + 1;

/** The served directory specs/assets.md lands the sprites under. */
const GEMS_DIR = ["assets", "gems"];

/** The side of one cell of the contact sheet the check leaves as evidence. */
const CONTACT_CELL = 72;

/** One produced picture, with the digest that tells it apart from another. */
interface Sprite {
  path: string;
  hash: string;
}

/** Every directory at or below `root`. */
function directoriesUnder(root: string): string[] {
  const found: string[] = [root];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) found.push(...directoriesUnder(path));
  }
  return found;
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
 * opaque pixel anywhere in it, is not a produced sprite however it was named.
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
    if (pixels[at] === 255) {
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
        Math.floor(index / columns) * CONTACT_CELL + (CONTACT_CELL - height) / 2,
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

  // Every directory below `assets/gems/` counted on its own, so the sprites are
  // found wherever the build grouped them and a sequence's frames are never
  // counted alongside them.
  let best: Sprite[] = [];
  for (const dir of directoriesUnder(gems)) {
    const sprites = await spritesIn(dir);
    if (sprites.length > best.length) best = sprites;
  }
  best.sort((a, b) => a.path.localeCompare(b.path));
  await writeContactSheet("sprites", best);

  assertGreaterThanOrEqual(
    best.length,
    REQUIRED_SPRITES,
    "distinct produced PNG sprites, each decoding with opaque pixels, " +
      "gathered in one directory under assets/gems/",
  );
});
