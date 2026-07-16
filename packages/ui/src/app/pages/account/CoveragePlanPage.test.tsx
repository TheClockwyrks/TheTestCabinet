import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { CoverageCell } from "@test-cabinet/run-record/coverage";
import {
  GalleryDataProvider,
  type GalleryDataInput,
} from "../../data/galleryContext";
import { CaseSection, type CaseGroup } from "./CoveragePlanPage";

// A case section starts collapsed: its overall progress bar shows, but the
// per-harness/model rows are hidden until the reviewer expands it — the behavior
// the account Coverage tab relies on to keep a large plan scannable. Mirrors the
// Inputs/Changelog accordion's collapse.

function galleryValue(): GalleryDataInput {
  return {
    producedSummaries: [],
    localIds: new Set(),
    writeups: {},
    reviews: {},
    runsLoading: false,
    queryRunSummaries: async () => ({ summaries: [], total: 0 }),
    testCases: [],
    testCasesStatus: "ready",
    models: [],
    modelsStatus: "ready",
    canExecute: true,
  } as unknown as GalleryDataInput;
}

function cell(): CoverageCell {
  return {
    slug: "pong",
    version: "v1.0.0",
    variant: "base",
    harness: "claude",
    model: "claude-sonnet-4-5",
    desired: 3,
    completed: 1,
    inFlight: 0,
    remaining: 2,
    latestVersion: "v1.0.0",
    stale: false,
  } as CoverageCell;
}

function group(): CaseGroup {
  const c = cell();
  return {
    cell0: c,
    cells: [c],
    done: 1,
    desired: 3,
    donePct: 33,
    flightPct: 0,
  };
}

function renderSection() {
  return render(
    <MemoryRouter>
      <GalleryDataProvider value={galleryValue()}>
        <CaseSection
          group={group()}
          busy={false}
          canTrigger
          onTrigger={vi.fn()}
        />
      </GalleryDataProvider>
    </MemoryRouter>,
  );
}

describe("CaseSection collapse", () => {
  it("starts collapsed: the toggle is not expanded and the rows are hidden", () => {
    renderSection();
    const toggle = screen.getByRole("button", { expanded: false });
    expect(toggle).toBeTruthy();
    // The per-combination row (harness · model) is not rendered while collapsed.
    expect(screen.queryByText(/claude-sonnet-4-5/)).toBeNull();
    // The overall progress count is always visible.
    expect(screen.getByText("1/3")).toBeTruthy();
  });

  it("expands to reveal the per-harness/model rows when toggled", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByRole("button", { expanded: true })).toBeTruthy();
    expect(screen.getByText(/claude-sonnet-4-5/)).toBeTruthy();
  });
});
