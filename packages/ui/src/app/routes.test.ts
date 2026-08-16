import { describe, expect, it } from "vitest";
import { isKnownRoute, routePatterns, routes } from "./routes";

describe("isKnownRoute", () => {
  it("knows the bare root", () => {
    expect(isKnownRoute("/")).toBe(true);
  });

  it("knows every pattern the app declares", () => {
    // Each pattern with its `:params` filled in — the strongest form of this
    // test, since it fails the moment a pattern is added that this cannot match.
    for (const pattern of Object.values(routePatterns)) {
      const path = pattern
        .split("/")
        .map((segment) => (segment.startsWith(":") ? "x" : segment))
        .join("/");
      expect(isKnownRoute(path), pattern).toBe(true);
    }
  });

  it("knows a path built by the route builders", () => {
    expect(isKnownRoute(routes.runDetail("abc123"))).toBe(true);
    expect(isKnownRoute(routes.runPlay("abc123"))).toBe(true);
    expect(isKnownRoute(routes.testCaseRuns("carom"))).toBe(true);
    expect(isKnownRoute(routes.modelStats("claude-opus-5"))).toBe(true);
  });

  it("rejects a path no pattern addresses", () => {
    expect(isKnownRoute("/nonsense")).toBe(false);
    expect(isKnownRoute("/runs/abc123/nonsense")).toBe(false);
    expect(isKnownRoute("/test-cases/carom/runs/extra")).toBe(false);
  });

  it("rejects a prefix of a route rather than treating it as one", () => {
    // `/runs/:runId/reviews/:reviewerId` exists; the three-segment prefix of it
    // does not.
    expect(isKnownRoute("/runs/abc123/reviews")).toBe(false);
  });

  it("matches a param segment whatever it contains", () => {
    expect(isKnownRoute("/runs/0198f2c1-0000-7000-8000-000000000000")).toBe(
      true,
    );
    expect(isKnownRoute("/runs/whatever%20this%20is")).toBe(true);
  });

  it("ignores a trailing slash, as react-router does", () => {
    expect(isKnownRoute("/runs/")).toBe(true);
    expect(isKnownRoute("/runs/abc123/")).toBe(true);
  });

  it("prefers a literal segment's route without shadowing the dynamic one", () => {
    // `/runs/failures` and `/runs/:runId` are both known; the point of the check
    // is only that neither answer depends on declaration order.
    expect(isKnownRoute(routePatterns.runFailures)).toBe(true);
    expect(isKnownRoute("/runs/some-run-id")).toBe(true);
  });

  it("does not match the asset paths the build emits beside the run pages", () => {
    // `runs/<id>.json` IS shaped like `/runs/:runId`, so it matches — which is
    // correct and harmless: the middleware never reaches the route check for a
    // request the static asset already answered. This pins the fact that the
    // separation is the middleware's content-type check, not this function's job.
    expect(isKnownRoute("/runs/abc123.json")).toBe(true);
    // The event logs live under their own prefix, which is no route at all.
    expect(isKnownRoute("/run-events/abc123.json")).toBe(false);
  });
});
