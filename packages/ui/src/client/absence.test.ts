import { describe, expect, it } from "vitest";
import { HttpReadError, httpStatusOf, isAbsence, readOutcome } from "./absence";

// The rule both hosts' resolvers classify a completed fetch by. It exists
// because the static gallery collapsed every failed read into the same `null`
// its "no such run" answer uses, so an offline visitor — or one served a 500 by
// the CDN — was told the run did not exist. Absence is a `404` and nothing else.

function response(status: number, statusText = ""): Response {
  return new Response(status === 204 ? null : "{}", { status, statusText });
}

describe("readOutcome", () => {
  it("reads a served body as found", () => {
    expect(readOutcome(response(200), "run abc")).toBe("found");
  });

  it("reads the store's own 404 as an absence", () => {
    expect(readOutcome(response(404, "Not Found"), "run abc")).toBe("absent");
  });

  // The whole point: none of these is the store saying it holds no such run, so
  // none of them may resolve to the null a caller prints as "not found".
  it.each([500, 502, 503, 403, 401, 429])("throws on HTTP %i", (status) => {
    expect(() => readOutcome(response(status), "run abc")).toThrow(
      new RegExp(`run abc: HTTP ${status}`),
    );
  });

  // The HTTP transports' own message shape (`<subject>: HTTP <status>:
  // <detail>`), so one failure reads the same whichever host surfaced it.
  it("carries the status text into the message when the server sent one", () => {
    expect(() =>
      readOutcome(response(503, "Service Unavailable"), "events for run abc"),
    ).toThrow("events for run abc: HTTP 503: Service Unavailable");
  });
});

// The status has to survive the throw as DATA. It used to survive only inside
// the message, and the live gallery read it back out with a regular expression —
// so the backend's own words, which `detail` carries verbatim, were part of the
// control flow.
describe("HttpReadError", () => {
  it("carries the status as a number alongside the message", () => {
    const error = new HttpReadError("run abc", 503, "Service Unavailable");
    expect(error.status).toBe(503);
    expect(error.subject).toBe("run abc");
    expect(error.message).toBe("run abc: HTTP 503: Service Unavailable");
    expect(error).toBeInstanceOf(Error);
  });

  it("is what readOutcome throws, status and all", () => {
    try {
      readOutcome(response(500, "Oops"), "run abc");
      expect.unreachable("a 500 must not classify");
    } catch (cause) {
      expect(httpStatusOf(cause)).toBe(500);
      expect(isAbsence(cause)).toBe(false);
    }
  });
});

describe("isAbsence", () => {
  it("reads a carried 404 as an absence", () => {
    expect(isAbsence(new HttpReadError("/runs/abc", 404, "no such run"))).toBe(
      true,
    );
  });

  // THE REGRESSION. `detail` is the backend's own envelope message and is free
  // to quote a URL, an upstream's reply, or its own log line. A substring test
  // read this 500 as the store saying it holds no such run, and the run detail
  // page printed "No run found for abc" for a store that was simply broken.
  it("reads a 500 whose message contains “HTTP 404” as a failure", () => {
    const cause = new HttpReadError(
      "/runs/abc",
      500,
      "upstream GET /internal/runs/abc failed: HTTP 404 from the artifact service",
    );
    expect(cause.message).toContain("HTTP 404");
    expect(isAbsence(cause)).toBe(false);
    expect(httpStatusOf(cause)).toBe(500);
  });

  // A read that never reached a store cannot be the store answering. Offline,
  // CORS, an abort, a DNS failure: all failures, none of them absences.
  it("reads an error carrying no status as a failure", () => {
    expect(isAbsence(new TypeError("Failed to fetch"))).toBe(false);
    expect(httpStatusOf(new TypeError("Failed to fetch"))).toBeNull();
    // Including one whose text would have matched the old regular expression.
    expect(isAbsence(new Error("/runs/abc: HTTP 404: no such run"))).toBe(
      false,
    );
  });

  it("is not fooled by a non-error thrown value", () => {
    expect(isAbsence("HTTP 404")).toBe(false);
    expect(isAbsence(null)).toBe(false);
    expect(isAbsence({ status: 404 })).toBe(false);
  });

  // The console bundles this package and the static site imports it; an error
  // from a duplicate copy of the module must still be understood, so the status
  // is read off the field rather than only by `instanceof`.
  it("reads the status off a same-shaped error from another copy of the module", () => {
    const foreign = Object.assign(new Error("/runs/abc: HTTP 404: gone"), {
      status: 404,
    });
    expect(isAbsence(foreign)).toBe(true);
  });
});
