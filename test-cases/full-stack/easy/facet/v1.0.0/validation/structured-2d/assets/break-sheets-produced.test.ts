// assets/break-sheets-produced — the produced break sheets ship with the build.
//
// specs/assets.md, "Animations — draw-sheet": "A break animation for each of the
// seven kinds, a short sequence in which the stone fractures and flies apart",
// with "Land each sequence under its own directory" and, of `draw-sheet` itself,
// "emitting one separate PNG per frame (frames are separate files, never regions
// of one image)". Seven sequences, each its own directory, each holding frames
// that are separate files.
//
// WHAT A SEQUENCE DIRECTORY IS HERE. A directory below the produced `assets/`
// tree that holds two or more PNGs and no subdirectory of its own — "its own
// directory", holding frames and nothing else. The rule is written over shape
// rather than over names because the specification fixes neither: its
// `public/assets/gems/break/ruby/` is given as an example, and a build that named
// its sequences otherwise has still produced them. The same shape rule keeps the
// single sprites out of the count, since specs/assets.md lands them "directly in
// `public/assets/gems/`, with each `draw-sheet` sequence in its own directory
// beside them".
//
// WHY THE FRAMES ARE HASHED. A sequence whose frames are all the same picture is
// what a build that emitted its sheet without advancing `draw-sheet`'s frame
// index produces: seven directories, forty-two files, and a stone that never
// fractures. So a directory counts only when at least two of its frames DIFFER,
// which is the least a sequence "in which the stone fractures and flies apart"
// can do.
//
// WHAT IS NOT ASKED. Nothing here reads a frame's content beyond whether it
// decodes and whether it is the same picture as another. How the fracture looks,
// how many frames it runs for, and which directory belongs to which kind are all
// the build's, and the specification names no file at all.
//
// The prism's idle turn is a produced sequence too, and it is counted here
// alongside the break sheets: nothing in the tree tells the two apart. Whether
// that turn actually PLAYS is `assets/prism-turn-animates`, which reads the
// running game rather than the tree.

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
import {
  ASSETS_DIR,
  MIN_SHEET_FRAMES,
  REQUIRED_BREAK_SHEETS,
} from "../constants";
import { mediaDestination, siteRoot } from "../harness";

/** The height one frame is drawn at in the filmstrip left as evidence. */
const STRIP_FRAME = 96;

/** A produced sequence: the directory it lives in and the frames it holds. */
interface Sheet {
  dir: string;
  frames: string[];
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

/** Whether `dir` holds a directory of its own. */
function hasSubdirectory(dir: string): boolean {
  return readdirSync(dir).some((entry) =>
    statSync(join(dir, entry)).isDirectory(),
  );
}

/** The PNG files directly in `dir`, in name order. */
function pngsIn(dir: string): string[] {
  return readdirSync(dir)
    .filter((entry) => entry.toLowerCase().endsWith(".png"))
    .sort()
    .map((entry) => join(dir, entry))
    .filter((path) => statSync(path).isFile());
}

/** The digest of a file that decodes as an image, or `null` when it does not. */
async function frameHash(path: string): Promise<string | null> {
  const bytes = readFileSync(path);
  try {
    const image = await loadImage(bytes);
    if (image.width < 1 || image.height < 1) return null;
  } catch {
    return null;
  }
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The sequence `dir` holds, or `null` when it holds none.
 *
 * A directory qualifies when it is a leaf carrying at least two frames that
 * decode, of which at least two are different pictures.
 */
async function readSheet(dir: string): Promise<Sheet | null> {
  if (hasSubdirectory(dir)) return null;
  const candidates = pngsIn(dir);
  if (candidates.length < MIN_SHEET_FRAMES) return null;
  const frames: string[] = [];
  const hashes = new Set<string>();
  for (const path of candidates) {
    const hash = await frameHash(path);
    if (hash === null) continue;
    frames.push(path);
    hashes.add(hash);
  }
  if (frames.length < MIN_SHEET_FRAMES || hashes.size < MIN_SHEET_FRAMES)
    return null;
  return { dir, frames };
}

/**
 * One sequence's frames laid out left to right, as the item's evidence.
 *
 * Evidence only: nothing here decides the verdict, and a strip that cannot be
 * written is reported and swallowed.
 */
async function writeFilmstrip(outputId: string, sheet: Sheet): Promise<void> {
  const destination = mediaDestination(outputId, "png");
  if (destination === null) return;
  try {
    const canvas = createCanvas(STRIP_FRAME * sheet.frames.length, STRIP_FRAME);
    const context = canvas.getContext("2d");
    context.fillStyle = "#3a3a3f";
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (const [index, path] of sheet.frames.entries()) {
      const image = await loadImage(readFileSync(path));
      const scale = Math.min(
        STRIP_FRAME / image.width,
        STRIP_FRAME / image.height,
      );
      const width = image.width * scale;
      const height = image.height * scale;
      context.drawImage(
        image,
        index * STRIP_FRAME + (STRIP_FRAME - width) / 2,
        (STRIP_FRAME - height) / 2,
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

it("ships at least seven multi-frame produced sequences", async () => {
  const root = siteRoot();
  assertNotNull(root, "the built site, or the committed public/ tree");
  const assets = join(root as string, ASSETS_DIR);
  if (!existsSync(assets)) {
    fail(`a produced ${ASSETS_DIR}/ directory under ${root}`, "absent");
  }

  const sheets: Sheet[] = [];
  for (const dir of directoriesUnder(assets)) {
    const sheet = await readSheet(dir);
    if (sheet !== null) sheets.push(sheet);
  }
  sheets.sort((a, b) => a.dir.localeCompare(b.dir));
  if (sheets.length > 0) await writeFilmstrip("sheet", sheets[0]);

  assertGreaterThanOrEqual(
    sheets.length,
    REQUIRED_BREAK_SHEETS,
    "produced directories holding two or more PNG frames, " +
      "at least two of which are different pictures",
  );
});
