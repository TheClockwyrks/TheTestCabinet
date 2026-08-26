import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { RunRecord, RunShowcase } from "@test-cabinet/run-record";
import { routePatterns } from "../../../routes";
import { RunPlayPage, RunPlayRedirect } from "./RunPlayPage";

// The page under test is the landing route's play-or-redirect decision; the run
// chrome is the layout's business, so hand the body the fixture run directly.
const fixture = vi.hoisted(() => ({
  run: null as RunRecord | null,
}));
vi.mock("../../../layouts/runs/RunDetailLayout", () => ({
  RunDetailLayout: ({
    children,
  }: {
    children: (ctx: { run: RunRecord }) => ReactNode;
  }) => children({ run: fixture.run! }),
}));
vi.mock("../PlayableSection", () => ({
  PlayableSection: ({ run }: { run: RunRecord }) => (
    <p>playable build for {run.id}</p>
  ),
}));
vi.mock("./ShowcaseSection", () => ({
  ShowcaseSection: ({ run }: { run: RunRecord }) => (
    <p>showcase for {run.id}</p>
  ),
}));

function run(overrides: {
  testType?: string;
  state?: string;
  showcase?: RunShowcase;
}): RunRecord {
  return {
    id: "run-1",
    subject: {
      testCaseSlug: "carom",
      testType: overrides.testType ?? "end-to-end",
      variant: "base",
    },
    status: { state: overrides.state ?? "completed" },
    showcase: overrides.showcase,
  } as unknown as RunRecord;
}

// Mount the run detail routes the way the app's router wires them: the bare run
// URL is the Play page, `/verdict` the Verdict tab, and the legacy `/play` path
// a redirect to the bare URL.
function mount(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path={routePatterns.runDetail} element={<RunPlayPage />} />
        <Route path={routePatterns.runVerdict} element={<p>verdict tab</p>} />
        <Route path={routePatterns.runPlay} element={<RunPlayRedirect />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("the run landing route", () => {
  it("lands a playable run on the Play tab", () => {
    fixture.run = run({});
    mount("/runs/run-1");
    expect(screen.getByText("playable build for run-1")).toBeTruthy();
    // Without a showcase on the record — every run recorded before the field
    // existed — the tab is the plain playable section and nothing else.
    expect(screen.queryByText(/showcase/)).toBeNull();
  });

  it("renders the showcase when the record carries one", () => {
    fixture.run = run({
      showcase: { description: "A great game.", media: [] },
    });
    mount("/runs/run-1");
    expect(screen.getByText("showcase for run-1")).toBeTruthy();
    // The showcase section owns the whole tab body (it embeds the gated launch
    // itself), so the bare playable section is not also mounted beside it.
    expect(screen.queryByText("playable build for run-1")).toBeNull();
  });

  it("redirects a run with no playable build to the Verdict tab", () => {
    // An asset-generation run produces a static asset, never a playable build.
    fixture.run = run({ testType: "asset-generation" });
    mount("/runs/run-1");
    expect(screen.getByText("verdict tab")).toBeTruthy();
    expect(screen.queryByText(/playable build/)).toBeNull();
  });

  it("redirects a results-scored run to its Results tab", () => {
    fixture.run = run({ testType: "performance" });
    mount("/runs/run-1");
    expect(screen.getByText("verdict tab")).toBeTruthy();
  });

  it("redirects a run whose state produced no build", () => {
    fixture.run = run({ state: "catastrophic" });
    mount("/runs/run-1");
    expect(screen.getByText("verdict tab")).toBeTruthy();
  });

  it("keeps old /play deep links working by redirecting to the landing route", () => {
    fixture.run = run({});
    mount("/runs/run-1/play");
    expect(screen.getByText("playable build for run-1")).toBeTruthy();
  });

  it("chains an old /play link on an unplayable run through to the Verdict tab", () => {
    fixture.run = run({ testType: "adversarial" });
    mount("/runs/run-1/play");
    expect(screen.getByText("verdict tab")).toBeTruthy();
  });
});
