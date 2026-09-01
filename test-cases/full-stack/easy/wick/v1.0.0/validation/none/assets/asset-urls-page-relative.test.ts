// assets/asset-urls-page-relative — the built site runs mounted under a
// sub-path.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("Where the files land, and how
// they are loaded"): "Every URL it requests resolves against the page rather than
// against the origin root, so the site runs unchanged whether it is served from
// the root of a static host or mounted under a sub-path. A root-absolute URL such
// as `/assets/sprites/ground.png` does not meet this: it resolves against the
// origin and fails under a sub-path."
//
// THE DRIVE. The site is put in exactly the situation the sentence names: served
// mounted under a sub-path, where a page-relative URL stays under the mount and a
// root-absolute one escapes it. This suite brings its own server for that, since
// the project's shared one serves the build at the root; nothing about the build
// is changed. The reading is the requests the page actually makes — every
// same-origin request stays under the mount and every one of them resolves — plus
// the game coming up at all, which is what "runs unchanged" costs a build whose
// script or asset URLs were built against the origin root.
//
// THE TOLERANCE. None on the paths: a request is under the mount or it is not.
// The settling wait is the harness's own allowance, not a figure of the
// specification's: a full-stack build fetches its produced files after the page
// loads, and the log is read once they have had time to arrive.
//
// WHAT IT DELIBERATELY DOES NOT READ. That the build invokes no tool and fetches
// nothing from outside its own output is `assets/build-self-contained`; what the
// mounted page draws is every presentation point's.

import { it } from "vitest";
import { fail } from "../assert";
import { HANDLE } from "../constants";
import { writeImageBytes } from "./media-out";
import { openSite } from "./site";

/** The sub-path the site is mounted under: two segments deep, so a bare `/` fails. */
const PREFIX = "/mounted/deep/";

/** How long the surface is waited for before the mount is called a failure. */
const SURFACE_TIMEOUT_MS = 15_000;

/** How long the produced files are given to arrive before the log is read. */
const SETTLE_MS = 2_000;

/** How many escaped or failed requests a failure names before it stops listing. */
const LISTED = 5;

it("runs unchanged mounted under a sub-path", async () => {
  const site = await openSite({ prefix: PREFIX });
  try {
    let surfaced = true;
    try {
      await site.page.waitForFunction(
        (handle) =>
          typeof (window as unknown as Record<string, unknown>)[handle] ===
          "object",
        HANDLE,
        { timeout: SURFACE_TIMEOUT_MS },
      );
    } catch {
      surfaced = false;
    }
    await site.page.waitForTimeout(SETTLE_MS);
    writeImageBytes("resolved", await site.page.screenshot({ type: "png" }));

    const escaped = site.requests.filter(
      (request) => !request.path.startsWith(PREFIX),
    );
    if (escaped.length > 0) {
      fail(
        `every URL the site requests resolving against the page, under the ${PREFIX} mount`,
        `requests escaped the mount: ${escaped
          .slice(0, LISTED)
          .map((request) => request.path)
          .join(", ")}`,
      );
    }
    const unresolved = site.requests.filter(
      (request) => request.status === null || request.status >= 400,
    );
    if (unresolved.length > 0) {
      fail(
        `every URL the site requests resolving under the ${PREFIX} mount`,
        `requests failed to resolve: ${unresolved
          .slice(0, LISTED)
          .map(
            (request) =>
              `${request.path} (${request.status ?? "no response"})`,
          )
          .join(", ")}`,
      );
    }
    if (!surfaced) {
      fail(
        `the built site running unchanged when mounted under ${PREFIX}`,
        `window.${HANDLE} was still absent ${
          SURFACE_TIMEOUT_MS / 1000
        }s after the mounted page loaded`,
      );
    }
  } finally {
    await site.close();
  }
});
