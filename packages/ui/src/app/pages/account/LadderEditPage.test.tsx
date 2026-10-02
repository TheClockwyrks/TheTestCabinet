import { act, render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LadderInput, LadderOut } from "@clockwyrks/run-record/ladders";
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

// `legacy` names the case versions on the legacy manifest format, which a ladder cannot
// climb; `refuse` is a message the save is rejected with, as the backend's 400 is.
function backendValue(
  existing: LadderOut,
  { legacy = [] as string[], refuse = null as string | null } = {},
) {
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
      getCoverageSettings: async () => ({
        bufferTarget: { kind: "bounded", runs: 10 },
      }),
      updateLadder: async (_id: string, input: LadderInput) => {
        if (refuse) throw new Error(refuse);
        saved = input;
        return existing;
      },
      // The rung add-row's catalog. Empty is enough: these tests edit the climb the
      // ladder arrived with rather than adding to it.
      listTestCases: async () => [],
      // Only a version named legacy resolves (as one); every other is one the backend
      // does not hold, which a ladder is allowed to pin.
      resolveVersion: async (slug: string, version: string) =>
        legacy.includes(version)
          ? { slug, version, testType: "end-to-end", engineFormat: false }
          : null,
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
async function renderEditor(
  existing: LadderOut = ladder(),
  options: Parameters<typeof backendValue>[1] = {},
) {
  render(
    <MemoryRouter initialEntries={["/account/ladders/l1/edit"]}>
      <BackendProvider value={backendValue(existing, options)}>
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

  // The report this was built for: "3" could not be replaced by "5" without
  // selecting it, because clearing the field snapped it back to 1 under the caret.
  it("lets the run target be cleared and retyped, and refuses to save while it is empty", async () => {
    await renderEditor();
    const runs = screen.getByLabelText("Runs per rung") as HTMLInputElement;
    expect(runs.value).toBe("3");

    fireEvent.change(runs, { target: { value: "" } });
    expect(runs.value).toBe("");
    expect(runs).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Runs per rung is required.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save ladder" })).toBeDisabled();
    await save();
    expect(saved).toBeNull();

    fireEvent.change(runs, { target: { value: "5" } });
    expect(runs.value).toBe("5");
    await save();
    expect(saved?.runsPerCell).toBe(5);
  });

  it("refuses to save a run target outside the range a rung may ask for", async () => {
    await renderEditor();
    const runs = screen.getByLabelText("Runs per rung") as HTMLInputElement;

    fireEvent.change(runs, { target: { value: "0" } });
    // Held as typed rather than corrected to the floor behind the operator's back.
    expect(runs.value).toBe("0");
    expect(screen.getByText("Runs per rung must be 1 or more.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save ladder" })).toBeDisabled();
    await save();
    expect(saved).toBeNull();
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

// A ladder climbs by itself: the validators rate every run, and the backend tops the
// ladder up as each one finishes. Nothing on the editor may say a review feeds it.
describe("LadderEditPage feeding copy", () => {
  it("describes auto top-up as climbing as runs finish, on by default", async () => {
    await renderEditor();
    const toggle = screen.getByLabelText("Keep climbing as runs finish");
    expect(toggle).toBeChecked();
    expect(
      screen.getByText(/Each run that finishes lets the backend launch/),
    ).toBeTruthy();
    expect(screen.queryByText(/submit a review/i)).toBeNull();
    fireEvent.click(toggle);
    await save();
    expect(saved?.schedule?.autoTopUp).toBe(false);
  });

  it("calls the buffer what it caps on a ladder: runs in flight", async () => {
    await renderEditor();
    expect(screen.getByText("Runs in flight at once")).toBeTruthy();
    expect(screen.queryByText("Review buffer")).toBeNull();
    expect(screen.getByText(/10 runs in flight/)).toBeTruthy();
  });
});

// A rung must be validator-rated. One the ladder already holds that is not is marked
// in the climb, and the save is refused with the reason until it is replaced.
describe("LadderEditPage unclimbable rungs", () => {
  it("marks a loaded legacy rung and refuses the save until it is replaced", async () => {
    await renderEditor(ladder(), { legacy: ["v1.0.0"] });
    expect(screen.getAllByText("Not climbable")).toHaveLength(2);
    expect(screen.getByText(/2 rungs are not validator-rated/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save ladder" })).toBeDisabled();
    await save();
    expect(saved).toBeNull();

    fireEvent.click(screen.getByLabelText("Remove rung 2"));
    fireEvent.click(screen.getByLabelText("Remove rung 1"));
    expect(screen.queryByText("Not climbable")).toBeNull();
  });

  it("shows the backend's refusal as it comes", async () => {
    const message =
      "`alpha` v1.0.0 is a legacy case version and cannot be a ladder rung";
    await renderEditor(ladder(), { refuse: message });
    await save();
    expect(screen.getByText(new RegExp(message))).toBeTruthy();
  });
});
