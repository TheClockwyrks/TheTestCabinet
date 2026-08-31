// assets/asset-urls-page-relative — asset URLs resolve against the page.
//
// specs/assets.md: "Every URL it requests resolves against the page rather
// than against the origin root, so the site runs unchanged whether it is
// served from the root of a static host or mounted under a sub-path. A
// root-absolute URL such as `/assets/sprites/planet.png` does not meet this:
// it resolves against the origin and fails under a sub-path."
//
// So the site is put in exactly the situation the sentence names: served
// mounted under `/mounted/deep/`, where a page-relative URL stays under the
// mount and a root-absolute one escapes it. The reading is the requests the
// page actually makes — every same-origin request stays under the mount and
// every one of them resolves — plus the game coming up at all, which is what
// "runs unchanged" costs a build that constructed its script or asset URLs
// against the origin root.

import { it } from "vitest";
import { fail } from "../assert";
import { HANDLE } from "../surface";
import { writeImageBytes } from "./media-out";
import { openSite } from "./site";

const PREFIX = "/mounted/deep/";

it("runs unchanged mounted under a sub-path", async () => {
  const site = await openSite({ prefix: PREFIX });
  try {
    let surfaced = true;
    try {
      await site.page.waitForFunction(
        (handle) =>
          typeof (window as never)[handle] === "object" &&
          (window as never)[handle] !== null,
        HANDLE,
        { timeout: 10_000 },
      );
    } catch {
      surfaced = false;
    }
    // Let every produced file's request settle before reading the log.
    await site.page.waitForTimeout(1_500);
    writeImageBytes("resolved", await site.page.screenshot({ type: "png" }));

    const escaped = site.requests.filter(
      (request) =>
        !request.path.startsWith(PREFIX) && request.path !== "/favicon.ico",
    );
    if (escaped.length > 0) {
      fail(
        `every URL the site requests resolving against the page, under the ${PREFIX} mount`,
        `requests escaped the mount: ${escaped
          .slice(0, 5)
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
          .slice(0, 5)
          .map((request) => `${request.path} (${request.status ?? "no response"})`)
          .join(", ")}`,
      );
    }
    if (!surfaced) {
      fail(
        `the built site running unchanged when mounted under ${PREFIX} (specs/assets.md, where the files land)`,
        `window.${HANDLE} was still absent 10s after the mounted page loaded`,
      );
    }
  } finally {
    await site.close();
  }
});
