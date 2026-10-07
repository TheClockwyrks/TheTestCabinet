// assets/built-site-fetches-nothing-external — the built site loads nothing from
// outside its own output directory.
//
// THE RULE, from the opening of `specs/assets.md`: "Production is a one-time
// step. The tools belong to this machine and are absent when the project is
// installed and rebuilt elsewhere, so the committed files are the assets: `npm
// ci` and `npm run build` invoke no tool, and the built site fetches nothing from
// outside its own `dist/`." The half this point decides is the second one. It is
// the same requirement the file opens with — every sprite, sheet, glyph, effect,
// cue and the music bed is "produced with them during this build, committed to
// the repository, and bundled by it" — read at the far end: what the build
// bundled is what the finished site loads, and there is nothing else for it to
// ask anyone for.
//
// WHAT IS READ. The site `npm run build` emitted, which is `dist/`, `build/` or
// `out/` — the three names the runner serves a build out of, in that order. Every
// text file in it is scanned for URLs in the positions a browser LOADS from: an
// `src` or `href` attribute, a CSS `url()` or `@import`, and in script a `fetch`,
// an `import`, a `new URL`, a `new Image`/`Audio`/`Worker`, an `importScripts`,
// or an assignment to `.src` or `.href`. A URL that merely appears in the text is
// not a request — the XML namespace inside an inlined SVG and the project page in
// a licence banner are both `https://` and neither is ever fetched — so neither
// is counted.
//
// WHICH OF THOSE IS "OUTSIDE ITS OWN `dist/`". One that names another origin: a
// scheme such as `http:` or `https:`, or a protocol-relative `//host`. A `data:`
// or `blob:` URL carries its own bytes and leaves the site for nothing, and a
// bundler is free to inline a small produced PNG as one — that file is still the
// committed file and the site still asks nobody for it. WHERE a path resolves
// against — the page or the origin root — is the separate point
// `assets/asset-urls-page-relative` decides; here a path of the site's own is a
// file of the site either way.
//
// THE VERDICT. The build emitted a site, and not one URL it loads from names a
// location outside it. A build that hotlinks a font, a CDN script, a stock sound
// or a sprite it did not produce carries that URL here and fails.
//
// THE EVIDENCE is the reference table itself, so a reviewer sees what the site
// asks for and where each of them lives.

import { it } from "vitest";
import { assertDeepEqual, assertGreaterThan, assertNotNull } from "../assert";
import {
  builtOutput,
  showSiteRequests,
  siteRequests,
  type SiteRequest,
} from "./site-requests";

it("emits a site whose every loaded URL is a file of its own", () => {
  const output = builtOutput();
  const requests: SiteRequest[] = output === null ? [] : siteRequests(output);
  showSiteRequests("requests", output, requests);

  assertNotNull(
    output,
    "the site npm run build emitted, under dist/, build/ or out/",
  );
  assertGreaterThan(
    requests.length,
    0,
    "the built site loads at least its own bundle, so the scan found the emitted files rather than nothing",
  );
  assertDeepEqual(
    requests
      .filter((request) => request.external)
      .map((request) => request.url),
    [],
    "the built site fetches nothing from outside its own dist/, so no URL it loads from names another origin",
  );
});
