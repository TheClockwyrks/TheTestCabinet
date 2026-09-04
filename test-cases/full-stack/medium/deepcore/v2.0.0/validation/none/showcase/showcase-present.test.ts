// showcase/showcase-present — the finished game ships the showcase it owes, and
// the carousel points at media that is really there.
//
// `specs/showcase.md` asks the build for the store-page presentation of Deepcore,
// in a `showcase/` directory at the root of this repository:
// `showcase/showcase.md` carries the description, `showcase/showcase.toml`
// carries the carousel, and every media file the carousel names sits directly
// beside them, each under 25 MiB, with the carousel holding two to four entries.
// This point asks whether that showcase EXISTS, in exactly those terms.
//
// NOTHING ABOUT THE MEDIA IS DECIDED HERE. Not a dimension, not a byte of a
// picture, not a word of the prose, not whether the first entry really is the
// strongest view of live play. Whether the description reads like something a
// player would want to play, and whether the carousel is worth looking at, is a
// reviewer's judgement and is rated through the `presentation` domain. What
// automation can honestly say is that the showcase is there, is shaped the way
// the specification fixes it, and does not point at nothing.
//
// EVERY FIGURE IT DOES DECIDE IS ONE THE SPECIFICATION STATES EXACTLY, and every
// one of them is imported from `../constants`, where it was transcribed from
// `specs/showcase.md` beside the rest of the case's figures. That file fixes the
// two file names and their directory, fixes `[[media]]` as tables of `file` and
// `name`, fixes `file` as a name "directly in `showcase/`, with no path
// separators", fixes the count at "two to four entries", and fixes the ceiling at
// 25 MiB. A build that satisfies every one of those sentences passes whatever its
// media shows.
//
// SO THIS SUITE DRIVES NOTHING. It opens no game, poses no scenario and touches
// no debug surface: it reads the produced tree with `node:fs`, which is why the
// one check stands unchanged in all three engine projects and means the same
// thing whichever engine the run selected. The repository root is two directories
// up from this file, because a staged validator project sits at `validation/` in
// the root of the tree the build produced, and that root is where
// `specs/showcase.md` puts `showcase/`.
//
// THE CAROUSEL IS READ FOR ITS `[[media]]` TABLES. `specs/showcase.md` shows the
// document as a run of `[[media]]` tables each carrying a `file` and a `name`, so
// this reads the tables it opens and the two keys it states, and interprets
// nothing else about the TOML — a build that spaced its tables differently, quoted
// with either quote, or wrote its keys in the other order has still written the
// document the specification asked for.
//
// THE EVIDENCE IS THE BUILD'S OWN. The still handed to the reviewer is a `.png`
// copied out of `showcase/` — the first the carousel names, or failing that the
// first sitting there — so what stands beside the verdict is a picture the build
// chose to present its game with. It is a copy and never a comparison: nothing
// here reads a pixel of it, and a showcase carrying no `.png` at all leaves the
// output absent rather than failing the point.

import { expect, it } from "vitest";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { assertTrue, fail } from "../assert";
import {
  SHOWCASE_CAROUSEL as CAROUSEL,
  SHOWCASE_DESCRIPTION as DESCRIPTION,
  SHOWCASE_DIR,
  SHOWCASE_MAX_ENTRIES as MAX_ENTRIES,
  SHOWCASE_MAX_MEDIA_BYTES as MAX_MEDIA_BYTES,
  SHOWCASE_MIN_ENTRIES as MIN_ENTRIES,
} from "../constants";

/* -------------------------------------------------------------------------- */
/* Where the showcase sits                                                    */
/* -------------------------------------------------------------------------- */

/** This validator project's own directory: `validation/` once staged. */
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The root of the repository the build produced, which holds `showcase/`. */
const WORKSPACE = join(PROJECT_ROOT, "..");

/** The showcase directory itself. */
const SHOWCASE = resolve(WORKSPACE, SHOWCASE_DIR);

/* -------------------------------------------------------------------------- */
/* Reading the tree                                                           */
/* -------------------------------------------------------------------------- */

/** Whether `path` is a file that can be read. A directory is not one. */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The size of a file in bytes, or `null` where it cannot be read. */
function sizeOf(path: string): number | null {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Reading the carousel                                                       */
/* -------------------------------------------------------------------------- */

/** One `[[media]]` table, as this point reads it. */
interface Entry {
  /** The `file` the table states, or `null` where it states none. */
  file: string | null;
  /** The `name` the table states, or `null` where it states none. */
  name: string | null;
}

/** The value of a bare string key inside one table's text, or `null`. */
function stringKey(table: string, key: string): string | null {
  const pattern = new RegExp(
    `^[ \\t]*${key}[ \\t]*=[ \\t]*(?:"([^"\\n]*)"|'([^'\\n]*)')`,
    "m",
  );
  const match = pattern.exec(table);
  if (match === null) return null;
  const value = match[1] ?? match[2] ?? "";
  return value === "" ? null : value;
}

/**
 * Every `[[media]]` table the carousel states, in the order it states them.
 *
 * A table runs from its own header to the next header of any kind, which is what
 * makes a `file` read here belong to the entry it was written under.
 */
function entriesOf(document: string): Entry[] {
  const headers = [...document.matchAll(/^[ \t]*\[\[[ \t]*media[ \t]*\]\]/gm)];
  const nextHeader = /^[ \t]*\[/gm;
  const entries: Entry[] = [];
  for (const header of headers) {
    const from = (header.index ?? 0) + header[0].length;
    nextHeader.lastIndex = from;
    const following = nextHeader.exec(document);
    const table = document.slice(from, following?.index ?? document.length);
    entries.push({
      file: stringKey(table, "file"),
      name: stringKey(table, "name"),
    });
  }
  return entries;
}

/**
 * Whether a `file` is the bare name `specs/showcase.md` requires: "a file
 * directly in `showcase/`, with no path separators".
 */
function isBareName(file: string): boolean {
  if (file.includes("/") || file.includes("\\")) return false;
  if (file === "." || file === "..") return false;
  const at = resolve(SHOWCASE, file);
  const within = relative(SHOWCASE, at);
  return within !== "" && !within.startsWith("..") && !isAbsolute(within);
}

/* -------------------------------------------------------------------------- */
/* The evidence                                                               */
/* -------------------------------------------------------------------------- */

/** The environment variable the runner names the media directory in. */
const MEDIA_DIR_ENV = "TCAB_VALIDATION_MEDIA_DIR";

/** The directory the runner stages this project to inside the build's tree. */
const STAGED_PROJECT_DIR = "validation";

/**
 * Where this suite's `outputId` output belongs, or `null` when nothing is
 * collecting media.
 *
 * The harness beside this file computes the same address, and this suite states
 * it again rather than reaching for that one: the harness's copy is a detail of
 * DRIVING the game, called from the module that owns the browser or the canvas a
 * picture comes off, and this suite drives nothing and imports no harness at all.
 * Both derive the address from the staged suite path, which is the name the
 * manifest and the runner already agree on, so neither can drift from the other
 * without drifting from that.
 */
function mediaDestination(outputId: string, extension: string): string | null {
  const mediaDir = process.env[MEDIA_DIR_ENV];
  if (mediaDir === undefined || mediaDir === "") return null;
  const testPath = expect.getState().testPath;
  if (testPath === undefined) return null;
  const suite = relative(PROJECT_ROOT, testPath).split(sep).join("/");
  return join(mediaDir, STAGED_PROJECT_DIR, suite, `${outputId}.${extension}`);
}

/** Whether a name ends in the extension a screenshot ships under. */
function isPng(name: string): boolean {
  return name.toLowerCase().endsWith(".png");
}

/**
 * The `.png` this point hands the reviewer: the first the carousel names, or
 * failing that the first sitting in `showcase/`, or `null` when there is none.
 */
function evidence(named: readonly string[]): string | null {
  const fromCarousel = named
    .filter(isPng)
    .map((file) => resolve(SHOWCASE, file))
    .find(isFile);
  if (fromCarousel !== undefined) return fromCarousel;
  let listing: string[];
  try {
    listing = readdirSync(SHOWCASE);
  } catch {
    return null;
  }
  return (
    listing
      .filter(isPng)
      .sort()
      .map((name) => join(SHOWCASE, name))
      .find(isFile) ?? null
  );
}

/**
 * Keep a `.png` out of the build's own showcase as this point's output.
 *
 * Never throws and never decides anything. Outside a run the media directory is
 * unset and this is a no-op; a showcase with no picture in it, or a host that
 * cannot be written to, leaves the output absent, which the runner already
 * reports as an output that never turned up.
 */
function captureShowcaseStill(named: readonly string[]): void {
  const destination = mediaDestination("carousel", "png");
  if (destination === null) return;
  const source = evidence(named);
  if (source === null) return;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  } catch (error) {
    console.warn(`deepcore: could not write ${destination}: ${String(error)}`);
  }
}

/* -------------------------------------------------------------------------- */
/* The point                                                                  */
/* -------------------------------------------------------------------------- */

it("ships a showcase whose carousel names media that is there", () => {
  const description = resolve(WORKSPACE, DESCRIPTION);
  const carousel = resolve(WORKSPACE, CAROUSEL);

  assertTrue(
    isFile(description),
    `${DESCRIPTION}, the showcase's description, present at the root of the ` +
      "repository (specs/showcase.md)",
  );
  assertTrue(
    (sizeOf(description) ?? 0) > 0,
    `${DESCRIPTION} carrying the description of the game (specs/showcase.md)`,
  );
  assertTrue(
    isFile(carousel),
    `${CAROUSEL}, the showcase's carousel, present at the root of the ` +
      "repository (specs/showcase.md)",
  );

  const entries = entriesOf(readFileSync(carousel, "utf8"));
  const named = entries
    .map((entry) => entry.file)
    .filter((file): file is string => file !== null);

  // Before the assertions, so a carousel that named nothing present still leaves
  // whatever picture the showcase does hold beside the verdict.
  captureShowcaseStill(named);

  if (entries.length < MIN_ENTRIES || entries.length > MAX_ENTRIES) {
    fail(
      `${MIN_ENTRIES} to ${MAX_ENTRIES} [[media]] entries in ${CAROUSEL} ` +
        "(specs/showcase.md: the carousel holds two to four entries)",
      `${entries.length}`,
    );
  }

  for (const [index, entry] of entries.entries()) {
    const where = `[[media]] entry ${index + 1} of ${entries.length}`;
    if (entry.file === null) {
      fail(
        `${where} to carry a \`file\` naming its media (specs/showcase.md)`,
        "no `file` key",
      );
    }
    if (entry.name === null) {
      fail(
        `${where} to carry a \`name\`, its caption (specs/showcase.md)`,
        `file = "${entry.file}", with no \`name\` key`,
      );
    }
    if (!isBareName(entry.file)) {
      fail(
        `${where} to name a file directly in showcase/, with no path ` +
          "separators (specs/showcase.md)",
        `file = "${entry.file}"`,
      );
    }
    const at = resolve(SHOWCASE, entry.file);
    if (!isFile(at)) {
      fail(
        `${where}'s file present in showcase/ (specs/showcase.md: every file ` +
          "the carousel names exists there)",
        `showcase/${entry.file} is not there`,
      );
    }
    const bytes = sizeOf(at) ?? 0;
    if (bytes >= MAX_MEDIA_BYTES) {
      fail(
        `${where}'s file under 25 MiB (specs/showcase.md)`,
        `showcase/${entry.file} is ${bytes} bytes`,
      );
    }
  }
});
