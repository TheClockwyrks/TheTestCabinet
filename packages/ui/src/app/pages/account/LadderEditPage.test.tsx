import { act, render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LadderInput, LadderOut } from "@test-cabinet/run-record/ladders";
import type { BackendClient } from "../../../client/clients";
import { BackendProvider } from "../../../client/context";
import {
  GalleryDataProvider,
  type GalleryDataInput,
} from "../../data/galleryContext";
import { LadderEditPage } from "./LadderEditPage";

// The page's app chrome reads contexts none of these tests are about; stub it as the
// other account page tests do.
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../../client/auth", () => ({
  useAuth: () => ({ token: "t0" }),
}));
// The climber picker asks the account for its gg configurations; the climb is what
// these tests are about, so it has none.
vi.mock("../runs/gg/useGgConfigs", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../runs/gg/useGgConfigs")>();
  return {
    ...actual,
    useGgConfigs: () => ({
      options: [],
      saved: [],
      loading: false,
      error: null,
      reload: async () => {},
    }),
  };
});

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

/** A stored ladder that is already savable: a climb, and one climber pinned on it. */
function ladder(over: Partial<LadderOut> = {}): LadderOut {
  return {
    id: "l1",
    name: "E2E climb",
    runsPerCell: 3,
    gate: {
      floor: "scuffed",
      threshold: { kind: "count", runs: 1 },
      unloadedCountsAsBroken: true,
      earlyStop: false,
    },
    comboGroupIds: [],
    combos: [{ harness: "claude", model: "opus" }],
    rungs: [
      { id: "r1", slug: "alpha", version: "v1.0.0", variant: "base" },
      {
        id: "r2",
        slug: "alpha",
        version: "v1.0.0",
        variant: "base",
        engine: "simple-2d",
        runs: 5,
      },
    ],
    updatedAt: "2026-01-01T00:00:00Z",
    outerAxis: "rung",
    paused: true,
    autoTopUp: true,
    ...over,
  } as unknown as LadderOut;
}

let saved: LadderInput | null = null;

function backendValue(existing: LadderOut) {
  return {
    client: {
      listCoverageGroups: async () => [],
      getLadder: async () => existing,
      getLadderSchedule: async () => ({
        outerAxis: existing.outerAxis,
        paused: existing.paused,
        autoTopUp: existing.autoTopUp,
      }),
      listModels: async () => [],
      getCoverageSettings: async () => ({ bufferTarget: 10 }),
      updateLadder: async (_id: string, input: LadderInput) => {
        saved = input;
        return existing;
      },
      // The rung add-row's catalog. Empty is enough: these tests edit the climb the
      // ladder arrived with rather than adding to it.
      listTestCases: async () => [],
      resolveVersion: async () => null,
    } as unknown as BackendClient,
    identity: null,
    status: "ready" as const,
    error: null,
    url: null,
    setUrl: () => {},
  };
}

// The ladder, its groups, and the account's buffer default all resolve
// asynchronously, so every render flushes them before asserting.
async function renderEditor(existing: LadderOut = ladder()) {
  render(
    <MemoryRouter initialEntries={["/account/ladders/l1/edit"]}>
      <BackendProvider value={backendValue(existing)}>
        <GalleryDataProvider value={galleryValue()}>
          <Routes>
            <Route
              path="/account/ladders/:ladderId/edit"
              element={<LadderEditPage />}
            />
            {/* Saving navigates back to the ladders list, not under test. */}
            <Route path="*" element={<div />} />
          </Routes>
        </GalleryDataProvider>
      </BackendProvider>
    </MemoryRouter>,
  );
  await act(async () => {});
}

async function save() {
  fireEvent.click(screen.getByRole("button", { name: "Save ladder" }));
  await act(async () => {});
}

beforeEach(() => {
  saved = null;
});

// A save rewrites the climb whole, so anything the load→save round trip drops is
// dropped from the ladder itself. Nothing on this page edits a rung's pin, which is
// exactly why the loss would go unnoticed.
describe("LadderEditPage round trip", () => {
  it("saves back the engine each rung was pinned to", async () => {
    await renderEditor();
    await save();
    expect(saved?.rungs).toEqual([
      { id: "r1", slug: "alpha", version: "v1.0.0", variant: "base" },
      {
        id: "r2",
        slug: "alpha",
        version: "v1.0.0",
        variant: "base",
        engine: "simple-2d",
        runs: 5,
      },
    ]);
  });

  it("keeps every rung's stable id, so recorded verdicts stay attached", async () => {
    await renderEditor();
    await save();
    expect(saved?.rungs.map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("names each rung's engine in the climb, so two pins of one case are two rows", async () => {
    await renderEditor();
    // The catalog lists nothing here, so the case name is titled from the slug —
    // the engine is the half under test.
    expect(screen.getByText("Alpha · base · v1.0.0")).toBeTruthy();
    expect(screen.getByText("Alpha · base · v1.0.0 · Simple 2D")).toBeTruthy();
  });

  it("does not resume a ladder its reviewer has since disabled", async () => {
    await renderEditor();
    await save();
    expect(saved?.schedule?.paused).toBe(true);
  });
});
