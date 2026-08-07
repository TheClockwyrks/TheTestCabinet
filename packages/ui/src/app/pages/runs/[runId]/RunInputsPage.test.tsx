import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { RunRecord } from "@test-cabinet/run-record";
import { describe, expect, it, vi } from "vitest";
import type { VariantSummary } from "../../../data/testCases";
import { RunInputsPage } from "./RunInputsPage";

// The tab under test is the accordion of inputs; the surrounding run chrome
// (header, tab bar, review fetching) is irrelevant to it, so hand the body a
// fixture run directly.
vi.mock("../../../layouts/runs/RunDetailLayout", () => ({
  RunDetailLayout: ({
    children,
  }: {
    children: (ctx: { run: RunRecord }) => ReactNode;
  }) => children({ run: run() }),
}));
// The variant comes from the injected catalog; stub it rather than stand up a
// gallery data provider, since these tests are about the run's own inputs.
vi.mock("../../../data/useRunVariant", () => ({
  useRunVariant: (): VariantSummary => ({
    slug: "base",
    name: "Base",
    description: null,
    prompt: "Build a game.",
    seededInputs: [],
    packages: [],
    referenceScreenshots: [],
    reviewItems: [],
    domains: [],
    referenceBuild: null,
    referenceSheet: null,
  }),
}));

// A game-jam run briefed with two earlier entries of the same model, oldest
// first — the order they were seeded in.
function run(): RunRecord {
  return {
    id: "run-newest",
    subject: { testCaseSlug: "tide", variant: "base", testType: "game-jam" },
    gameJamPriorEntries: [
      {
        runId: "run-older",
        finishedAt: "2026-01-01T00:00:00Z",
        readme: "# Space Miner\n\nDig for ore.",
      },
      {
        runId: "run-newer",
        finishedAt: "2026-02-02T00:00:00Z",
        readme: "# Tide Pool\n\nTend a pool.",
      },
    ],
    // The tab reads only the subject and the prior entries off the record.
  } as unknown as RunRecord;
}

describe("RunInputsPage", () => {
  // The seeded READMEs are inputs like any other, so they belong in the same
  // accordion, under the paths the model read them at.
  it("lists each seeded previous entry as an input file", () => {
    render(<RunInputsPage />);

    expect(
      screen.getByText("previous-entries/entry-01.md"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("previous-entries/entry-02.md"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Previous entry")).toHaveLength(2);
  });

  // Inline, in full — the point of recording the READMEs on the run is that what
  // it was shown can be read here rather than chased to another run.
  it("reveals a previous entry's README inline when expanded", () => {
    render(<RunInputsPage />);

    fireEvent.click(screen.getByText("previous-entries/entry-01.md"));
    expect(screen.getByText("Space Miner")).toBeInTheDocument();
    expect(screen.getByText("Dig for ore.")).toBeInTheDocument();
  });

  // Nothing on this tab points at the runs the entries came from: the input is
  // the README, and a link to another run is not an input.
  it("never links out to the runs the entries came from", () => {
    render(<RunInputsPage />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("run-older")).toBeNull();
    expect(screen.queryByText("run-newer")).toBeNull();
  });
});
