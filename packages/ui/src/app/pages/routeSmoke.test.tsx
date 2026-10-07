import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GalleryApp } from "../GalleryApp";
import type { GalleryDataInput } from "../data/galleryContext";
import { routePatterns } from "../routes";
import {
  FIXTURE_IDS,
  HostProviders,
  emptyGallery,
  readOnlyGallery,
  stockedGallery,
} from "./routeSmokeFixtures";

// EVERY PAGE LOADS.
//
// This suite exists because a page can be completely broken — throwing on first
// paint, taking the whole app down with it — while every other test in the repo
// passes. A suite that covers only the pages somebody remembered to write a test
// for cannot catch that; the page nobody covered is exactly the page that breaks.
//
// So it is driven off `routePatterns` rather than a list kept here: a route added
// to the app is a route this walks, immediately and without anyone remembering to
// add it. Each is mounted through the real `GalleryApp` — the real router, the
// real chrome, the real page components — against several shapes of host, and the
// bar is simply that the page renders: no throw, and something on screen.
//
// It is a smoke test, deliberately. It says nothing about whether a page is
// CORRECT; the per-page suites do that. It says a page is not BROKEN, which is
// the thing that was going unnoticed.

// The value each `:param` segment is filled with. Fixed rather than random so a
// failure is reproducible, and resolvable by the stocked fixture so detail pages
// find the thing they are about. `runId` is per-host (see HOSTS) and filled in
// separately.
const PARAM_VALUES: Record<string, string> = {
  slug: FIXTURE_IDS.slug,
  modelId: FIXTURE_IDS.modelId,
  reviewerId: FIXTURE_IDS.reviewerId,
  planId: FIXTURE_IDS.planId,
  ladderId: FIXTURE_IDS.ladderId,
  groupId: FIXTURE_IDS.groupId,
  configId: FIXTURE_IDS.configId,
  agentId: FIXTURE_IDS.agentId,
  dashboardId: FIXTURE_IDS.dashboardId,
  jobId: FIXTURE_IDS.jobId,
  id: FIXTURE_IDS.comparisonId,
};

// The game-jam routes are the one family whose `:slug` is not a test case, so
// they take the jam's slug instead of the shared fill above.
const JAM_ROUTES = new Set([
  "gameJamDetail",
  "gameJamInputs",
  "gameJamRuns",
  "gameJamLeaderboard",
  "gameJamMetrics",
]);

/** One route pattern with its `:params` filled in — the path to actually visit. */
function pathFor(name: string, pattern: string, runId: string): string {
  return pattern
    .split("/")
    .map((segment) => {
      if (!segment.startsWith(":")) return segment;
      const param = segment.slice(1);
      if (param === "slug" && JAM_ROUTES.has(name)) return FIXTURE_IDS.jamSlug;
      if (param === "runId") return runId;
      const value = PARAM_VALUES[param];
      if (!value) {
        // A new `:param` nobody taught this suite about would otherwise be
        // silently visited as the literal `:whatever`, which is a path the page
        // may well survive without ever exercising what it is for.
        throw new Error(
          `route ${name} (${pattern}) has an unfilled :${param} — add it to PARAM_VALUES`,
        );
      }
      return value;
    })
    .join("/");
}

/**
 * Mount the whole app at one path and report what the boundary caught, if
 * anything. Effects are flushed inside `act`, so a page that throws from an
 * effect (not just from render) is caught here too.
 */
async function visit(path: string, data: GalleryDataInput): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <HostProviders data={data}>
          <GalleryApp />
        </HostProviders>
      </MemoryRouter>,
    );
  });
}

/** The message the page error boundary is showing, or null when it is not. */
function caughtError(): string | null {
  const panel = screen.queryByRole("alert");
  if (!panel || !panel.textContent?.includes("This page hit an error")) {
    return null;
  }
  return panel.querySelector("pre")?.textContent ?? "(no message)";
}

// The hosts every route is walked against. Each is a real shape the app ships in,
// and the empty one is where the "reaches into the first element of an empty
// list" class of failure surfaces. Each carries its own run id: the run-detail
// layout's cache of resolved runs is process-wide, so sharing one id would let a
// run the stocked host resolved reappear on the host that holds nothing.
const HOSTS: ReadonlyArray<{
  name: string;
  runId: string;
  data: (runId: string) => GalleryDataInput;
}> = [
  {
    name: "a console holding a stocked cabinet",
    runId: `${FIXTURE_IDS.runId}-stocked`,
    data: stockedGallery,
  },
  {
    name: "a console holding nothing",
    runId: `${FIXTURE_IDS.runId}-empty`,
    data: emptyGallery,
  },
  {
    name: "the read-only static gallery",
    runId: `${FIXTURE_IDS.runId}-static`,
    data: readOnlyGallery,
  },
];

describe.each(HOSTS)("every route renders on $name", ({ runId, data }) => {
  // React reports a caught render error through console.error as well, which
  // would otherwise bury the real assertion in pages of stack. The boundary is
  // what this suite reads; keep the console quiet and let the assertion speak.
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it.each(Object.entries(routePatterns))("%s", async (name, pattern) => {
    const path = pathFor(name, pattern, runId);
    await visit(path, data(runId));

    const error = caughtError();
    expect(error, `${path} threw while rendering: ${error}`).toBeNull();
    // A page that renders nothing at all is broken in a way no throw reports —
    // a route that matches no <Route>, say, which used to render the chrome
    // around an empty body.
    expect(
      document.body.textContent?.trim(),
      `${path} rendered nothing`,
    ).not.toBe("");
  });
});
