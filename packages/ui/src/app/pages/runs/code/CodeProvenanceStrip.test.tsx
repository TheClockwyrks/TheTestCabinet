import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CodeAnalysisSummary } from "@clockwyrks/run-record/code-analysis";
import { CodeProvenanceStrip } from "./CodeProvenanceStrip";

// The strip is the display half of R5's mitigation, and the risk register says plainly
// that the display half is what gets cut under time pressure. These tests are what stops
// that: a degraded basis has to *say* it is degraded, in words, because neither of the
// two degradations is visible in any figure on the page.

function summary(over: Partial<CodeAnalysisSummary> = {}): CodeAnalysisSummary {
  return {
    analyzerVersion: 1,
    authoredBasis: "seedCommit",
    treeBasis: "preValidation",
    languages: ["typeScript"],
    size: {} as CodeAnalysisSummary["size"],
    complexity: {} as CodeAnalysisSummary["complexity"],
    graph: {} as CodeAnalysisSummary["graph"],
    api: {} as CodeAnalysisSummary["api"],
    tests: {} as CodeAnalysisSummary["tests"],
    duplication: {} as CodeAnalysisSummary["duplication"],
    notes: {
      truncated: false,
      gitignoreApplied: true,
      filesSkipped: 0,
      bytesSkipped: 0,
      filesUnparsable: 0,
      filesRefused: 0,
    },
    ...over,
  };
}

describe("CodeProvenanceStrip", () => {
  it("states an exact basis without raising a caveat", () => {
    const { container } = render(<CodeProvenanceStrip summary={summary()} />);
    expect(screen.getByText("Exact")).toBeInTheDocument();
    expect(screen.getByText("Pre-validation")).toBeInTheDocument();
    expect(screen.getByText("TypeScript")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(container.querySelector("ul")).toBeNull();
  });

  // The authored set falling back to the whole tree counts the seeded scaffolding as
  // the model's own work. Nothing in a size figure shows it, so the strip has to.
  it("names a degraded authored set as degraded, in words", () => {
    render(
      <CodeProvenanceStrip summary={summary({ authoredBasis: "allFiles" })} />,
    );
    expect(screen.getByText("Degraded")).toBeInTheDocument();
    expect(
      screen.getByText(
        /seeded scaffolding is counted as the model's own work/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Not comparable with runs measured from a seed commit/i),
    ).toBeInTheDocument();
  });

  it("distinguishes an inferred basis from an exact one", () => {
    render(
      <CodeProvenanceStrip
        summary={summary({ authoredBasis: "rootCommit" })}
      />,
    );
    expect(screen.getByText("Inferred")).toBeInTheDocument();
  });

  // A tree measured after validation carries build output, a rewritten lockfile and
  // toolchain caches, in amounts that differ per case and per run.
  it("says when the tree was measured after the validator built in it", () => {
    render(
      <CodeProvenanceStrip
        summary={summary({ treeBasis: "postValidation" })}
      />,
    );
    expect(screen.getByText("Post-validation")).toBeInTheDocument();
    expect(
      screen.getByText(
        /build output, a rewritten lockfile and toolchain caches/i,
      ),
    ).toBeInTheDocument();
  });

  it("reports a truncated analysis, which cap fired, and what that means", () => {
    render(
      <CodeProvenanceStrip
        summary={summary({
          notes: {
            ...summary().notes,
            truncated: true,
            truncatedBy: "parseBytes",
          },
        })}
      />,
    );
    expect(
      screen.getByText(/the parse-byte budget was exhausted/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/excluded from aggregation by default/i),
    ).toBeInTheDocument();
  });

  // The caveat a reader cannot reconstruct from the page body: a refused file is in
  // the file table with its size, so nothing above it looks wrong — but every
  // parsed-only figure was computed without it.
  it("reports the source files the parse guard turned away", () => {
    render(
      <CodeProvenanceStrip
        summary={summary({ notes: { ...summary().notes, filesRefused: 2 } })}
      />,
    );
    expect(
      screen.getByText(
        /2 source files were too large or too deeply nested to parse/i,
      ),
    ).toBeInTheDocument();
  });

  it("says when no ignore file was in play", () => {
    render(
      <CodeProvenanceStrip
        summary={summary({
          notes: { ...summary().notes, gitignoreApplied: false },
        })}
      />,
    );
    expect(
      screen.getByText(/build output and dependencies may be counted/i),
    ).toBeInTheDocument();
  });

  it("says when nothing in the tree was in a language it parses", () => {
    render(<CodeProvenanceStrip summary={summary({ languages: [] })} />);
    expect(screen.getByText("Nothing")).toBeInTheDocument();
    expect(
      screen.getByText(/only size figures were produced/i),
    ).toBeInTheDocument();
  });
});
