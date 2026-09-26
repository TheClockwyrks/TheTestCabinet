import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { RunRecord } from "@clockwyrks/run-record";
import type {
  CodeAnalysisDocument,
  CodeAnalysisSummary,
} from "@clockwyrks/run-record/code-analysis";
import { RunCodePage } from "./RunCodePage";

// The page's chrome reads app-wide contexts that say nothing about the analysis. Stub
// them so these tests exercise the two-tier render: what comes off the record, and what
// comes off the separately fetched document.
vi.mock("../../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../../components/RunDeleteControl", () => ({
  RunDeleteControl: () => null,
}));
vi.mock("../../../data/useTestCaseName", () => ({
  useTestCaseName: () => (slug: string) => slug,
}));
vi.mock("../../../data/useModels", () => ({
  useFindModel: () => () => null,
}));
// The document tier is a **host hook**, not a client call — a console reads the backend
// route, the static site fetches the snapshot object — so it is stubbed here on the
// gallery, which is the seam the page actually reads.
const fixture = vi.hoisted(() => ({
  detail: null as unknown,
  readCodeAnalysis: undefined as
    | ((runId: string) => Promise<unknown>)
    | undefined,
}));
vi.mock("../../../data/galleryContext", () => ({
  useGalleryData: () => ({
    fetchRun: async () => fixture.detail,
    readCodeAnalysis: fixture.readCodeAnalysis,
    localIds: new Set<string>(),
    writeups: {},
    canExecute: false,
  }),
}));

const RUN_ID = "run-code";

const SUMMARY: CodeAnalysisSummary = {
  analyzerVersion: 1,
  authoredBasis: "seedCommit",
  treeBasis: "preValidation",
  languages: ["typeScript"],
  size: {
    files: 12,
    parsedFiles: 10,
    sizeOnlyFiles: 2,
    bytes: 40960,
    codeLines: 1250,
    commentLines: 90,
    blankLines: 140,
    directories: 4,
    maxDirectoryDepth: 2,
    meanFilesPerDirectory: 3,
    giniCodeLines: 0.42,
    rootShare: 0.1,
    maxFileCodeLines: 300,
    medianFileCodeLines: 80,
    p90FileCodeLines: 260,
    filesOver500Lines: 0,
    filesOver1000Lines: 0,
  },
  complexity: {
    functions: 48,
    totalCyclomatic: 200,
    maxCyclomatic: 41,
    meanCyclomatic: 4.1666,
    totalCognitive: 150,
    maxCognitive: 30,
    meanCognitive: 3.1,
    maxNesting: 5,
    meanMaxNesting: 1.8,
    maxParameters: 6,
    meanParameters: 1.4,
    maxExits: 4,
    meanExits: 1.2,
    functionsOver10Cyclomatic: 3,
    functionsOver20Cyclomatic: 1,
    maxFunctionLines: 120,
    meanFunctionLines: 18,
  },
  graph: {
    nodes: 10,
    edges: 14,
    cycles: 1,
    largestCycle: 2,
    filesInCycles: 2,
    meanInstability: 0.5,
    meanFanOut: 1.4,
    maxFanOut: 5,
    meanFanIn: 1.4,
    maxFanIn: 4,
    orphans: 1,
    maxDepth: 3,
    externalPackages: 2,
    entryPoints: 1,
  },
  api: {
    exports: 20,
    meanExportsPerModule: 2,
    unreferencedExports: 4,
    unreferencedExportRatio: 0.2,
  },
  tests: {
    testFiles: 1,
    testFunctions: 6,
    testCodeLines: 90,
    testLineRatio: 0.072,
  },
  duplication: {
    clonedLines: 40,
    clonedLineRatio: 0.032,
    cloneGroups: 2,
    largestCloneLines: 25,
  },
  notes: {
    truncated: false,
    gitignoreApplied: true,
    filesSkipped: 3,
    bytesSkipped: 2048,
    filesUnparsable: 0,
    filesRefused: 0,
  },
};

const DOCUMENT = {
  analyzerVersion: 1,
  summary: SUMMARY,
  files: [
    {
      path: "src/loop.ts",
      language: "typeScript",
      bytes: 4000,
      codeLines: 300,
      commentLines: 20,
      blankLines: 30,
      functions: 6,
      cyclomatic: 60,
      cognitive: 40,
      fanOut: 2,
      fanIn: 3,
      isTest: false,
    },
  ],
  symbols: [
    {
      file: 0,
      name: "resolveCollision",
      line: 12,
      lines: 120,
      cyclomatic: 41,
      cognitive: 30,
      maxNesting: 5,
      parameters: 3,
      exits: 4,
      exported: true,
      references: 2,
    },
  ],
  imports: [],
  cycles: [],
  clones: [],
} as unknown as CodeAnalysisDocument;

function renderPage(
  codeAnalysis: CodeAnalysisSummary | undefined,
  readCodeAnalysis?: (runId: string) => Promise<unknown>,
  toolchain?: unknown,
) {
  fixture.readCodeAnalysis = readCodeAnalysis;
  fixture.detail = {
    record: {
      id: RUN_ID,
      subject: {
        testCaseSlug: "coil",
        testCaseVersion: "v1.0.0",
        testType: "end-to-end",
        variant: "base",
        harnessSlug: "gg",
        harnessVersion: "0.7.0",
        modelId: "test/model",
      },
      status: { state: "completed", detail: null },
      validation: { loaded: true, proofs: [] },
      codeAnalysis,
      toolchain,
    } as unknown as RunRecord,
    reviews: [],
  };
  return render(
    <MemoryRouter initialEntries={[`/runs/${RUN_ID}/code`]}>
      <Routes>
        <Route path="/runs/:runId/code" element={<RunCodePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RunCodePage", () => {
  // The record carries the bounded summary, so the provenance, the headline figures and
  // the full figure table are on screen without waiting for a second request.
  it("renders the provenance, the headline figures and every catalog figure from the record", async () => {
    renderPage(SUMMARY, vi.fn().mockResolvedValue(DOCUMENT));

    expect(await screen.findByText("Exact")).toBeInTheDocument();
    expect(screen.getByText("Pre-validation")).toBeInTheDocument();
    // The KPI row. ("Code lines" also names a row of the catalog table below, so the
    // headline is identified by its figure.)
    expect(screen.getAllByText("Code lines").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1,250").length).toBeGreaterThan(0);
    expect(screen.getAllByText("4.2").length).toBeGreaterThan(0);
    // A figure that appears nowhere but the catalog-driven table, with its unit
    // applied — proof the table is driven by `CODE_METRICS` rather than hand-listed.
    expect(screen.getByText("Size Gini")).toBeInTheDocument();
    expect(screen.getByText("42.0%")).toBeInTheDocument();
  });

  it("fetches the document and builds the explorer from it", async () => {
    const readCodeAnalysis = vi.fn().mockResolvedValue(DOCUMENT);
    renderPage(SUMMARY, readCodeAnalysis);
    await waitFor(() => expect(readCodeAnalysis).toHaveBeenCalledWith(RUN_ID));
    expect(await screen.findByText("resolveCollision")).toBeInTheDocument();
    expect(
      screen.getByText("Everything in the produced tree"),
    ).toBeInTheDocument();
  });

  // A transport that cannot reach per-run media (the static site) simply never gets the
  // second tier. The summary half must still render, and the page must say which half
  // is missing rather than looking broken.
  it("keeps the summary when the transport cannot reach the document", async () => {
    renderPage(SUMMARY, undefined);
    expect(await screen.findByText("Exact")).toBeInTheDocument();
    expect(
      screen.getAllByText(/per-file detail isn’t available here/i).length,
    ).toBeGreaterThan(0);
  });

  // Reachable by typing the URL for a run recorded before the analyzer shipped.
  it("says a run carries no analysis rather than rendering an empty page of zeros", async () => {
    renderPage(undefined);
    expect(
      await screen.findByText(/corpus is not backfilled/i),
    ).toBeInTheDocument();
  });
});

// The executed tier: the model's own suite and its coverage, gated on whether the case
// actually wrote the report files those figures are read out of.
//
// Absence of the widget is the correct rendering, and these are the assertions that keep
// it that way. Every case version predating the report-file contract writes no report, so
// an empty widget here would appear on the entire existing corpus.
describe("RunCodePage, the executed tier", () => {
  const TESTS = {
    total: 12,
    passed: 11,
    failed: 1,
    skipped: 0,
    filesRun: 2,
    filesFailed: 1,
    succeeded: false,
    files: [{ path: "src/game.test.ts", passed: 11, failed: 1, skipped: 0 }],
    filesTruncated: false,
    failures: [
      {
        file: "src/game.test.ts",
        name: "engine > advances",
        message: "expected 3 to be 4",
      },
    ],
    failuresTruncated: false,
  };
  const COVERAGE = {
    totals: {
      lines: { covered: 62, total: 100, pct: 62 },
      statements: { covered: 70, total: 100, pct: 70 },
      functions: { covered: 8, total: 10, pct: 80 },
      branches: { covered: 3, total: 12, pct: 25 },
    },
    files: [
      {
        path: "src/loop.ts",
        lines: { covered: 62, total: 100, pct: 62 },
        statements: { covered: 70, total: 100, pct: 70 },
        functions: { covered: 8, total: 10, pct: 80 },
        branches: { covered: 3, total: 12, pct: 25 },
      },
    ],
    filesMeasured: 1,
    filesTruncated: false,
  };

  it("renders neither band for a run with no toolchain block", async () => {
    renderPage(SUMMARY, vi.fn().mockResolvedValue(DOCUMENT));
    expect(await screen.findByText("Exact")).toBeInTheDocument();
    expect(screen.queryByText(/Tests the model wrote/)).toBeNull();
    expect(
      screen.queryByText(/Coverage of the code the model wrote/),
    ).toBeNull();
  });

  // The shape of every run recorded before the report-file contract: the command ran and
  // printed a table, and no file was written for either reader to parse. Not an empty
  // widget, not a placeholder, not a zero — nothing.
  it("renders neither band when the command ran but wrote no report files", async () => {
    renderPage(SUMMARY, vi.fn().mockResolvedValue(DOCUMENT), {
      test: {
        result: {
          command: "npx vitest run --coverage",
          ran: true,
          exitCode: 0,
        },
      },
    });
    expect(await screen.findByText("Exact")).toBeInTheDocument();
    expect(screen.queryByText(/Tests the model wrote/)).toBeNull();
    expect(
      screen.queryByText(/Coverage of the code the model wrote/),
    ).toBeNull();
  });

  // Two files, two gates. A config that writes the test report and no coverage summary
  // shows one band and not the other.
  it("gates the two bands independently", async () => {
    renderPage(SUMMARY, vi.fn().mockResolvedValue(DOCUMENT), {
      test: { result: { ran: true }, tests: TESTS },
    });
    expect(
      await screen.findByText("Tests the model wrote"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Coverage of the code the model wrote/),
    ).toBeNull();
  });

  it("renders both bands, and says whose tests they are", async () => {
    renderPage(SUMMARY, vi.fn().mockResolvedValue(DOCUMENT), {
      test: { result: { ran: true }, tests: TESTS, coverage: COVERAGE },
    });
    expect(
      await screen.findByText("Tests the model wrote"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Coverage of the code the model wrote"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/The suite failed — 1 of 12 tests/),
    ).toBeInTheDocument();
    expect(screen.getByText("expected 3 to be 4")).toBeInTheDocument();
    expect(screen.getByText(/62 of 100 executable lines/)).toBeInTheDocument();

    // The wording a reviewer needs, on both bands: these figures are the model's own
    // suite over the model's own code. Each band's lead is one line, and the rest of the
    // distinction — that the test case's validators, whose verdicts the same reviewer
    // sees on a sibling surface, contribute nothing to them — is behind the "?" beside
    // it, where it is still on the page and still reachable.
    expect(
      screen.getByText(
        /tests the model wrote, run over the code the model wrote/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByLabelText(
        /validators are a separate suite that grades this run/i,
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByLabelText(
        /validators' suite has coverage disabled by design/i,
      ).length,
    ).toBeGreaterThan(0);
  });

  // Most stored runs predate the per-test list, and the fixture above is one of them: it
  // carries counts and failures and no `tests` array at all. A run recorded since gets the
  // disclosure, opened on its failures.
  it("discloses the recorded tests of a run whose record carries them", async () => {
    renderPage(SUMMARY, vi.fn().mockResolvedValue(DOCUMENT), {
      test: {
        result: { ran: true },
        tests: {
          ...TESTS,
          tests: [
            {
              file: "src/game.test.ts",
              name: "engine > advances",
              status: "failed",
              durationMs: 1500,
            },
            {
              file: "src/game.test.ts",
              name: "engine > holds",
              status: "passed",
            },
          ],
          testsTruncated: false,
        },
      },
    });
    expect(
      await screen.findByRole("button", { name: /The suite failed/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("engine > advances")).toBeInTheDocument();
    expect(screen.getByText("1.5 s")).toBeInTheDocument();
    expect(screen.getByText("expected 3 to be 4")).toBeInTheDocument();
  });

  // The per-file table the disclosure supersedes.
  it("no longer tables every test file the runner loaded", async () => {
    renderPage(SUMMARY, vi.fn().mockResolvedValue(DOCUMENT), {
      test: { result: { ran: true }, tests: TESTS },
    });
    expect(
      await screen.findByText("Tests the model wrote"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Every test file the runner loaded/)).toBeNull();
  });

  // The two families that used to collide with the executed figures, renamed. The static
  // counts stay on the page; what changes is that neither is called what the executed
  // tier is called.
  it("no longer heads a static family as Tests or Coverage", async () => {
    renderPage(SUMMARY, vi.fn().mockResolvedValue(DOCUMENT), {
      test: { result: { ran: true }, tests: TESTS, coverage: COVERAGE },
    });
    expect(await screen.findByText("Test authorship")).toBeInTheDocument();
    // Read off the headings rather than off the page text: "Tests" is a perfectly good
    // label for a tile counting executed tests, and the collision this rename removes was
    // only ever a collision between two SECTIONS.
    const headings = screen
      .getAllByRole("heading")
      .map((heading) => heading.textContent);
    expect(headings).toContain("Test authorship");
    expect(headings).toContain("Analysis notes");
    expect(headings).not.toContain("Tests");
    expect(headings).not.toContain("Coverage");
  });
});
