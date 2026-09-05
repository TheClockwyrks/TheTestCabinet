import { act, render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CoverageGroup,
  CoverageGroupInput,
} from "@clockwyrks/run-record/coverage";
import type { BackendClient } from "../../../client/clients";
import { BackendProvider } from "../../../client/context";
import {
  GalleryDataProvider,
  type GalleryDataInput,
} from "../../data/galleryContext";
import { GroupEditPage } from "./GroupEditPage";

vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../../client/auth", () => ({
  useAuth: () => ({ token: "t0" }),
}));
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

/** The one case the catalog offers, at one version supporting two engines. */
function galleryValue(): GalleryDataInput {
  return {
    producedSummaries: [],
    localIds: new Set(),
    writeups: {},
    reviews: {},
    runsLoading: false,
    queryRunSummaries: async () => ({ summaries: [], total: 0 }),
    testCases: [
      {
        slug: "carom",
        name: "Carom",
        testType: "end-to-end",
        assetKind: null,
        difficulty: "easy",
        tags: [],
        summary: null,
        versions: ["v1.0.0"],
        latestVersion: "v1.0.0",
      },
    ],
    testCasesStatus: "ready",
    models: [],
    modelsStatus: "ready",
    canExecute: true,
  } as unknown as GalleryDataInput;
}

function caseGroup(cases: CoverageGroup["cases"]): CoverageGroup {
  return {
    id: "g1",
    name: "E2E cases",
    kind: "case",
    combos: [],
    cases,
    updatedAt: "2026-01-01T00:00:00Z",
  } as unknown as CoverageGroup;
}

let saved: CoverageGroupInput | null = null;

function backendValue(existing: CoverageGroup) {
  return {
    client: {
      listCoverageGroups: async () => [existing],
      listModels: async () => [],
      updateCoverageGroup: async (_id: string, input: CoverageGroupInput) => {
        saved = input;
        return existing;
      },
      listTestCases: async () => [
        { slug: "carom", versions: ["v1.0.0"], name: "Carom" },
      ],
      resolveVersion: async () => ({
        slug: "carom",
        version: "v1.0.0",
        name: "Carom",
        variants: [{ slug: "base", name: "Base" }],
        engines: ["none", "simple-2d"],
        maxRuntimeSeconds: 600,
      }),
    } as unknown as BackendClient,
    identity: null,
    status: "ready" as const,
    error: null,
    url: null,
    setUrl: () => {},
  };
}

async function renderEditor(existing: CoverageGroup) {
  render(
    <MemoryRouter initialEntries={["/account/groups/g1/edit"]}>
      <BackendProvider value={backendValue(existing)}>
        <GalleryDataProvider value={galleryValue()}>
          <Routes>
            <Route
              path="/account/groups/:groupId/edit"
              element={<GroupEditPage />}
            />
            {/* Saving navigates back to the Groups tab, not under test. */}
            <Route path="*" element={<div />} />
          </Routes>
        </GalleryDataProvider>
      </BackendProvider>
    </MemoryRouter>,
  );
  await act(async () => {});
}

async function save() {
  fireEvent.click(screen.getByRole("button", { name: "Save group" }));
  await act(async () => {});
}

beforeEach(() => {
  saved = null;
});

// The group editor reuses the plan editor's case picker, and a plan referencing a case
// group gets exactly the pins the group holds — so a group that could not carry an
// engine would quietly widen every plan pointing at it back to the engineless run.
describe("GroupEditPage case groups", () => {
  it("names a stored case's engine on its pill, and leaves the engineless one unnamed", async () => {
    await renderEditor(
      caseGroup([
        { slug: "carom", version: "v1.0.0", variant: "base" },
        {
          slug: "carom",
          version: "v1.0.0",
          variant: "base",
          engine: "simple-2d",
        },
      ]),
    );
    expect(screen.getByText("Carom · base · v1.0.0")).toBeTruthy();
    expect(screen.getByText("Carom · base · v1.0.0 · Simple 2D")).toBeTruthy();
  });

  it("saves back the engine each stored case was pinned to", async () => {
    await renderEditor(
      caseGroup([
        {
          slug: "carom",
          version: "v1.0.0",
          variant: "base",
          engine: "simple-2d",
        },
      ]),
    );
    await save();
    expect(saved?.cases).toEqual([
      {
        slug: "carom",
        version: "v1.0.0",
        variant: "base",
        engine: "simple-2d",
      },
    ]);
  });

  it("adds a case on the engine the picker was set to", async () => {
    await renderEditor(caseGroup([]));
    fireEvent.change(screen.getByLabelText("Engine"), {
      target: { value: "simple-2d" },
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
    await save();
    expect(saved?.cases).toEqual([
      {
        slug: "carom",
        version: "v1.0.0",
        variant: "base",
        engine: "simple-2d",
      },
    ]);
  });

  it("sends no combinations for a group of cases", async () => {
    await renderEditor(
      caseGroup([{ slug: "carom", version: "v1.0.0", variant: "base" }]),
    );
    await save();
    expect(saved?.kind).toBe("case");
    expect(saved?.combos).toEqual([]);
  });
});
