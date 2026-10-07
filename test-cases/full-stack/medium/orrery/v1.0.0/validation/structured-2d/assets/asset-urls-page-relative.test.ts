// assets/asset-urls-page-relative — the produced files are named against the page.
//
// THE RULE, from Where the files land of `specs/assets.md`: "Every URL it
// requests resolves against the page rather than against the origin root, so the
// site runs unchanged whether it is served from the root of a static host or
// mounted under a sub-path. A root-absolute URL such as
// `/assets/sprites/motes/sol.png` does not meet this: it resolves against the
// origin and fails under a sub-path." Under an engine the same requirement is
// spelled over the engine's loader, which "resolves every path under one root,
// `assets/`, relative to the page the build is served from, so the build asks it
// for a path written relative to that root, such as `sprites/motes/sol.png` and
// `audio/place.wav`, rather than constructing a URL of its own."
//
// WHY IT IS ASKED. A built site is published wherever it is published — the root
// of a host, or a folder inside one — and a name beginning with `/` is read from
// the host's root whatever page asked for it. Such a build works on the machine
// that made it and shows a game with no art and no sound the moment it is mounted
// one directory deep.
//
// WHAT IT READS. The BUILT SITE — the output of the `npm run build` the manifest
// runs before any of these checks — for every name a produced file is reached by,
// and whether any of them begins with `/`. Both doors are read: the document's own
// `src` and `href`, which is how the page reaches the bundle it loads and which
// fails under a sub-path exactly as an asset does, and every quoted name in the
// site's own text, which is how the bundle reaches a produced file.
//
// WHY THE BUILT SITE AND NOT THE SOURCE. The sentence is about what the RUNNING
// GAME requests, and what runs is what the build emitted. Reading it there covers
// the names the build wrote by hand, the names the bundler rewrote, and the page's
// own — and covers nothing else: the scripts that PRODUCED the assets on this
// machine are not shipped, and a path in one of them names a file on a disk rather
// than a URL on a page.
//
// WHAT COUNTS AS A NAME FOR A PRODUCED FILE is derived from the produced-file
// table itself rather than restated: a string ending in an extension one of the
// produced files carries, or naming one of the directories they sit under. A file
// the bundler inlined as a `data:` URI is a produced file with no URL left to
// resolve, and is not one of these names.
//
// AND THE SCAN IS READ BACK AS NON-EMPTY, because a walk that found nothing would
// pass a build that names its files any way it likes. A site that reaches a
// produced file at all names it somewhere, and a site that inlined every one of
// them still names the bundle its own document loads.
//
// WHAT THIS POINT DOES NOT DECIDE. Whether the built site reaches anything
// OUTSIDE itself is `built-site-fetches-nothing-external`; whether each named
// file exists is the points about each produced file.
//
// THE EVIDENCE is every name the scan found, each shown beside where it lands
// once the site is mounted under a sub-path, so a reviewer reads the consequence
// rather than the rule.

import { it } from "vitest";
import { assertGreaterThan, assertLength, assertNotNull } from "../assert";
import {
  BUILD_OUTPUTS,
  SUB_PATH,
  builtSite,
  producedFileReferences,
  underSubPath,
} from "./asset-urls";
import { showPanel } from "./readouts";

/** How many names the panel lists before it summarizes the rest. */
const SHOWN = 40;

it("names every produced file against the page rather than the origin root", () => {
  const site = builtSite();
  const references = producedFileReferences();
  const rootAbsolute = references.filter((one) => one.rootAbsolute);

  showPanel(
    "sub-path",
    `The built game served under a sub-path — ${SUB_PATH}`,
    [
      `built site: ${site ?? "none found"}`,
      `${references.length} name(s) a produced file is reached by, ` +
        `${rootAbsolute.length} of them root-absolute`,
      "",
      ...references
        .slice(0, SHOWN)
        .map(
          (one) =>
            `${one.rootAbsolute ? "ROOT-ABSOLUTE" : "page-relative "}  ` +
            `${one.file}  ${one.ref}  ->  ${underSubPath(one.ref)}`,
        ),
      ...(references.length > SHOWN
        ? ["", `... and ${references.length - SHOWN} more`]
        : []),
    ],
  );

  assertNotNull(
    site,
    `a built site to read, in one of ${BUILD_OUTPUTS.join(", ")}`,
  );
  assertGreaterThan(
    references.length,
    0,
    "names a produced file is reached by in the built site, so the reading below is a scan that found the site's URLs",
  );
  assertLength(
    rootAbsolute.map((one) => `${one.file} ${one.ref}`),
    0,
    "names that begin with / and so resolve against the origin root rather than against the page",
  );
});
