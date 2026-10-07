/**
 * The address every request is addressed to.
 *
 * A browser build is served from an origin that answers `/api` itself, so it
 * configures nothing and every path is answered by the origin the page came
 * from. A build served from anywhere else is given the backend's address
 * through the global below: whatever serves it writes the global into
 * `/backend.js`, and a build that has to carry an address assigns the same
 * global before the page's first script runs. The development server leaves
 * the global unset and proxies `/api` to the server.
 */

declare global {
  interface Window {
    /**
     * The backend's address, where this build was given one.
     *
     * It is written by whatever serves the page and is absent in a build that
     * addresses the origin it was served from.
     */
    __THE_TEST_CABINET_BACKEND__?: string;
  }
}

/**
 * The global the address is read from, which `/backend.js` assigns.
 *
 * It is named once, here, and read by name: the identifier's length is the
 * project's, and a line that carried it would be wrapped or not by the
 * formatter depending on the project's name. This is that line, so it is
 * exempted from the width the formatter otherwise holds the file to.
 */
// prettier-ignore
export const BACKEND_GLOBAL = "__THE_TEST_CABINET_BACKEND__";

/** The trailing slashes an address carries, which the path supplies itself. */
const TRAILING_SLASHES = /\/+$/;

/**
 * The configured backend address, without its trailing slashes.
 *
 * A build that configured none answers the empty string, which addresses the
 * page's own origin.
 */
export function backendOrigin(): string {
  const configured =
    typeof window === "undefined" ? undefined : window[BACKEND_GLOBAL];
  return typeof configured === "string"
    ? configured.trim().replace(TRAILING_SLASHES, "")
    : "";
}

/**
 * The address `path` is reached at, where `path` begins with `/api/`.
 *
 * The origin drops every trailing slash and the path opens with one, so the two
 * are joined by exactly one slash whichever way the address was written.
 */
export function apiUrl(path: string): string {
  return `${backendOrigin()}${path}`;
}
