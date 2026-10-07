// assets/asset-urls — the names the BUILT SITE reaches its produced files by.
//
// A PRIVATE MODULE OF THIS DIRECTORY, named for the thing it reads rather than
// for a review item, and no manifest entry points at it. IT ASSERTS NOTHING: it
// walks the built site and reports every name it found a produced file under,
// and the suite that called it decides the point. It is the same text in all
// three projects, like everything here that is not `harness.ts` or `surface.ts`.
//
// WHAT IT IS FOR. `specs/assets.md` requires that "Every URL it requests resolves
// against the page rather than against the origin root, so the site runs
// unchanged whether it is served from the root of a static host or mounted under
// a sub-path. A root-absolute URL such as `/assets/sprites/motes/sol.png` does not
// meet this: it resolves against the origin and fails under a sub-path" — and,
// where the engine owns the loader, that "the build asks it for a path written
// relative to that root, such as `sprites/motes/sol.png` ... rather than
// constructing a URL of its own."
//
// WHY THE BUILT SITE AND NOT THE SOURCE. The sentence is about what the RUNNING
// GAME requests, and what runs is the output of `npm run build` — the command the
// manifest runs before any of these checks. Reading it there is what makes the
// reading complete: it covers the names the build wrote by hand, the names the
// bundler rewrote, and the document's own `src` and `href`, and it covers nothing
// else — the scripts that PRODUCED the assets on this machine are not shipped and
// name files on a disk rather than URLs on a page, so a path in one of them says
// nothing about what the site requests.
//
// WHAT COUNTS AS A NAME FOR A PRODUCED FILE is derived from the produced-file
// table itself rather than restated: a string ending in an extension one of the
// produced files carries, or naming one of the directories they sit under. A file
// the bundler inlined as a `data:` URI is a produced file with no URL left to
// resolve, and is simply not one of these names.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { WORKSPACE } from "../media";
import {
  AUDIO_FILES,
  PARTICLE_FILES,
  PRODUCED_SPRITES,
  assetFile,
} from "./files";

/**
 * Where `npm run build` may have put the site, in the order the runner looks.
 *
 * The same three names, in the same order, the case's own runner resolves a
 * build output by, so this module and the runner never disagree about which tree
 * is under test.
 */
export const BUILD_OUTPUTS = ["dist", "build", "out"] as const;

/** The files of a built site that can carry a URL in their text. */
const TEXT_FILES = /\.(?:html|js|mjs|cjs|css)$/;

/** Every produced file, by the path it sits at under the repository root. */
const PRODUCED: readonly string[] = [
  ...PRODUCED_SPRITES.map((sprite) => sprite.file),
  ...Object.values(PARTICLE_FILES),
  ...AUDIO_FILES,
];

/**
 * The file extensions the produced files carry, derived from the table rather
 * than restated: a name ending in one of these is a name for a produced file.
 */
const PRODUCED_EXTENSIONS: readonly string[] = [
  ...new Set(PRODUCED.map((path) => path.slice(path.lastIndexOf(".")))),
];

/**
 * The directories under the asset root the produced files sit in — `sprites`,
 * `audio`, `particles` — plus the asset root itself, also derived from the table.
 */
const PRODUCED_DIRECTORIES: readonly string[] = [
  ...new Set(
    PRODUCED.map((path) => path.split("/")[1] ?? "").filter(
      (one) => one !== "",
    ),
  ),
  assetFile("").replace(/\/$/, ""),
];

/** One name a produced file is reached by in the built site, and where. */
export interface AssetReference {
  /** The built file it sits in, relative to the repository root. */
  file: string;
  /** The name itself, as the built site carries it. */
  ref: string;
  /**
   * Whether it resolves against the ORIGIN ROOT rather than against the page: a
   * leading `/`, which names a path from the host's root, or a leading `//`,
   * which names another host altogether.
   */
  rootAbsolute: boolean;
}

/** The built site's directory, relative to the repository root, or `null`. */
export function builtSite(): string | null {
  for (const name of BUILD_OUTPUTS) {
    const at = join(WORKSPACE, name);
    if (existsSync(at) && readdirSync(at).length > 0) return name;
  }
  return null;
}

/**
 * Every path-like token in a text that ends in one of the produced extensions.
 *
 * A NAME IS MATCHED WHERE IT SITS, rather than by pairing up the quotes around
 * it. A built bundle is minified text carrying apostrophes inside its own
 * strings, so a walk that paired quotes would fall out of step part way through
 * a file and stop seeing the names after it — which would leave this reading
 * quietly blind, which is the one failure a check about a name must not have.
 * The token's own characters are what bound it: everything a URL path is spelled
 * with, which stops at the quote, the bracket or the colon around it.
 */
const NAME_TOKEN = new RegExp(
  `[A-Za-z0-9_~@%$.+{}/-]*\\.(?:${PRODUCED_EXTENSIONS.map((extension) =>
    extension.slice(1),
  ).join("|")})\\b`,
  "g",
);

/**
 * A root-absolute mention of one of the directories the produced files sit
 * under, for a build that keeps its asset root as a name of its own and joins a
 * path onto it. Only a token START counts, so a page-relative `./assets/` is not
 * one.
 */
const ROOT_DIRECTORY = new RegExp(
  `["'\`(=,\\s]/(?:${PRODUCED_DIRECTORIES.join("|")})/`,
  "g",
);

/** Every text file of the built site, deepest last, relative to the workspace. */
function textFilesOf(site: string): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory).sort()) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (TEXT_FILES.test(entry)) found.push(relative(WORKSPACE, path));
    }
  };
  walk(join(WORKSPACE, site));
  return found;
}

/**
 * Every name a produced file is reached by in the built site.
 *
 * Both doors a name comes through are read: the document's own `src` and `href`
 * attributes, which is how the page reaches the bundle it loads and which fails
 * under a sub-path exactly as an asset does, and every path-like name in the
 * site's own text, which is how the bundle reaches a produced file.
 */
export function producedFileReferences(): AssetReference[] {
  const site = builtSite();
  if (site === null) return [];
  const found: AssetReference[] = [];
  for (const file of textFilesOf(site)) {
    const text = readFileSync(join(WORKSPACE, file), "utf8");
    if (file.endsWith(".html")) {
      for (const match of text.matchAll(
        /(?:src|href)\s*=\s*["']([^"']+)["']/gi,
      )) {
        found.push({
          file,
          ref: match[1],
          rootAbsolute: match[1].startsWith("/"),
        });
      }
    }
    for (const match of text.matchAll(NAME_TOKEN)) {
      found.push({
        file,
        ref: match[0],
        rootAbsolute: match[0].startsWith("/"),
      });
    }
    for (const match of text.matchAll(ROOT_DIRECTORY)) {
      found.push({ file, ref: match[0].slice(1), rootAbsolute: true });
    }
  }
  return found;
}

/**
 * Where a page-relative name lands once the site is mounted under a sub-path,
 * for the panel a point about this leaves: the same name read against
 * `https://host/games/orrery/` rather than against `https://host/`.
 */
export const SUB_PATH = "https://host/games/orrery/";

/** `ref` resolved against {@link SUB_PATH}, as a browser would resolve it. */
export function underSubPath(ref: string): string {
  try {
    return new URL(ref, SUB_PATH).href;
  } catch {
    return ref;
  }
}
