// showcase/exists — the finished game ships its showcase, and the carousel points
// at something that is actually there.
//
// THE RULE, from `specs/showcase.md`: "It is a `showcase/` directory at the root
// of this repository, committed with the rest of the project, holding a
// description of the game and a short carousel of captured media." The layout is
// fixed there too — "`showcase/showcase.md`, the description", "
// `showcase/showcase.toml`, the carousel", "The media files the carousel and the
// description name" — and every file sits directly in `showcase/` with no
// subdirectories. This point asks only whether that showcase EXISTS: the two
// files, and one carousel entry naming a file that is present.
//
// NOTHING ABOUT THE MEDIA IS CHECKED. Not a dimension, not a byte of a picture,
// not a word of the prose, not how many entries the carousel holds, not whether
// the leading one moves. Whether the description reads like something a player
// would want to play, and whether the carousel opens on the strongest view of a
// machine running, is a reviewer's judgement and is rated through the
// `presentation` domain. What automation can honestly say is that the showcase is
// there and does not point at nothing, and that is the whole of this verdict.
//
// SO THIS SUITE DRIVES NOTHING. It opens no page, poses no scenario and touches
// no debug surface: it reads the produced tree with `node:fs`, which is why the
// one file stands unchanged in all three engine projects and the point means the
// same thing whichever engine the run selected. `WORKSPACE` from `../media` is
// the root of the tree the build produced — the validator project is staged to
// `validation/` inside it — and that root is where `specs/showcase.md` puts
// `showcase/`.
//
// THE CAROUSEL IS READ FOR ITS `file` KEYS ALONE. `specs/showcase.md` fixes the
// document as `[[media]]` tables of `file` and `name`, so every `file = "..."` it
// states is taken as an entry and nothing else about the TOML is interpreted — a
// build that laid its tables out differently still has its entries read, and a
// document this reads too generously can only be read in the build's favor,
// because one present name is all the point asks for. A name is resolved against
// `showcase/` and kept only while it stays inside it. `specs/showcase.md` has
// these be bare file names with no path separators, and a build that nested one
// has still shipped the media this point is about, so where inside its own
// showcase a present file sits is not what fails here.
//
// THE EVIDENCE IS THE BUILD'S OWN. The still handed to the reviewer is a `.png`
// copied out of `showcase/` — the first one the carousel names, or failing that
// the first one sitting there — so what stands beside the verdict is a picture
// the build chose to present its game with. It is a copy and never a comparison:
// nothing here reads a pixel of it, and a showcase carrying no `.png` at all
// leaves the output absent rather than failing the point.

import { it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { assertTrue, fail } from "../assert";
import { WORKSPACE, writeImageBytes } from "../media";

/* -------------------------------------------------------------------------- */
/* Where the showcase sits                                                    */
/* -------------------------------------------------------------------------- */

/** The showcase directory itself, at the root of the produced repository. */
const SHOWCASE = resolve(WORKSPACE, "showcase");

/** The two files `specs/showcase.md` names, as it addresses them. */
const DESCRIPTION = "showcase/showcase.md";
const CAROUSEL = "showcase/showcase.toml";

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

/**
 * Every `file = "..."` the carousel states, in the order it states them.
 *
 * Both TOML string forms are accepted, because both say the same thing and which
 * one a build reached for is not what this point is about.
 */
function carouselNames(document: string): string[] {
  const names: string[] = [];
  const key = /^[ \t]*file[ \t]*=[ \t]*(?:"([^"\n]*)"|'([^'\n]*)')/gm;
  for (const match of document.matchAll(key)) {
    const name = match[1] ?? match[2];
    if (name !== undefined && name !== "") names.push(name);
  }
  return names;
}

/**
 * Where a carousel name resolves inside `showcase/`, or `null` when it leaves the
 * directory — a name this point cannot honour, whatever is at the far end of it.
 */
function insideShowcase(name: string): string | null {
  const at = resolve(SHOWCASE, name);
  const within = relative(SHOWCASE, at);
  if (within === "" || within.startsWith("..") || isAbsolute(within))
    return null;
  return at;
}

/** One carousel entry whose file is present, as this point reads it. */
interface Present {
  /** The name the carousel stated. */
  name: string;
  /** Where that name resolved inside `showcase/`. */
  path: string;
}

/** Every carousel name that resolves inside `showcase/` to a file that exists. */
function presentEntries(names: readonly string[]): Present[] {
  const present: Present[] = [];
  for (const name of names) {
    const path = insideShowcase(name);
    if (path !== null && isFile(path)) present.push({ name, path });
  }
  return present;
}

/* -------------------------------------------------------------------------- */
/* The evidence                                                               */
/* -------------------------------------------------------------------------- */

/** Whether a name ends in the extension `specs/showcase.md` ships a still under. */
function isPng(name: string): boolean {
  return name.toLowerCase().endsWith(".png");
}

/**
 * The `.png` this point hands the reviewer: the first the carousel names, or
 * failing that the first sitting in `showcase/`, or `null` when there is none.
 */
function evidence(present: readonly Present[]): string | null {
  const named = present.find((entry) => isPng(entry.name));
  if (named !== undefined) return named.path;
  let listing: string[];
  try {
    listing = readdirSync(SHOWCASE);
  } catch {
    return null;
  }
  const beside = listing
    .filter(isPng)
    .sort()
    .map((name) => join(SHOWCASE, name))
    .find(isFile);
  return beside ?? null;
}

/**
 * Keep a `.png` out of the build's own showcase as this point's output.
 *
 * Never decides anything. Outside a run the media directory is unset and the
 * write is a no-op; a showcase with no picture in it leaves the output absent,
 * which the runner already reports as an output that never turned up.
 */
function captureShowcaseStill(present: readonly Present[]): void {
  const source = evidence(present);
  if (source === null) return;
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(source);
  } catch {
    return;
  }
  writeImageBytes("carousel", bytes);
}

/* -------------------------------------------------------------------------- */
/* The point                                                                  */
/* -------------------------------------------------------------------------- */

it("ships a showcase whose carousel names a file that is there", () => {
  const description = resolve(WORKSPACE, DESCRIPTION);
  const carousel = resolve(WORKSPACE, CAROUSEL);

  assertTrue(
    isFile(description),
    `${DESCRIPTION}, the showcase's description, present at the root of the repository — specs/showcase.md`,
  );
  assertTrue(
    isFile(carousel),
    `${CAROUSEL}, the showcase's carousel, present at the root of the repository — specs/showcase.md`,
  );

  const names = carouselNames(readFileSync(carousel, "utf8"));
  const present = presentEntries(names);

  // Before the assertion, so a carousel that named nothing present still leaves
  // whatever picture the showcase does hold beside the verdict.
  captureShowcaseStill(present);

  if (present.length === 0) {
    fail(
      "at least one `file` the carousel names to be present in showcase/ (specs/showcase.md: every file the carousel names exists there)",
      names.length === 0
        ? "the carousel states no `file` entries"
        : `named ${names.join(", ")} — none of them present`,
    );
  }
});
