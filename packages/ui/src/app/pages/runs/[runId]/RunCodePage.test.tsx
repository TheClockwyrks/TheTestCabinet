import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { RunRecord } from "@test-cabinet/run-record";
import type {
  CodeAnalysisDocument,
  CodeAnalysisSummary,
} from "@test-cabinet/run-record/code-analysis";
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
    await waitFor(() =>
      expect(readCodeAnalysis).toHaveBeenCalledWith(RUN_ID),
    );
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
