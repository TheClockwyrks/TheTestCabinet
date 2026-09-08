import { act, render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CoverageGroup,
  CoveragePlanInput,
  CoveragePlanOut,
} from "@clockwyrks/run-record/coverage";
import type { BackendClient } from "../../../client/clients";
import { BackendProvider } from "../../../client/context";
import {
  GalleryDataProvider,
  type GalleryDataInput,
} from "../../data/galleryContext";
import { CoveragePlanEditPage } from "./CoveragePlanEditPage";

// The page's app chrome reads contexts none of these tests are about; stub it as the
// other account page tests do.
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../../client/auth", () => ({
  useAuth: () => ({ token: "t0" }),
}));
// The one-off combination picker asks the account for its gg configurations; this
// page's settings are what these tests are about, so it has none.
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

function group(id: string, kind: "combo" | "case"): CoverageGroup {
  return {
    id,
    name: `${kind} group`,
    kind,
    combos: kind === "combo" ? [{ harness: "claude", model: "opus" }] : [],
    cases:
      kind === "case"
        ? [{ slug: "carom", version: "v1.0.0", variant: "base" }]
        : [],
    updatedAt: "2026-01-01T00:00:00Z",
  } as unknown as CoverageGroup;
}

// A saved plan that is already savable — one combination source and one case source —
// so a test can change a single setting and press Save.
function plan(over: Partial<CoveragePlanOut> = {}): CoveragePlanOut {
  return {
    id: "p1",
    name: "Anthropic / E2E",
    runsPerCell: 3,
    comboGroupIds: ["g-combo"],
    caseGroupIds: ["g-case"],
    combos: [],
    cases: [],
    updatedAt: "2026-01-01T00:00:00Z",
    outerAxis: "case",
    paused: false,
    autoTopUp: false,
    ...over,
  };
}

let saved: CoveragePlanInput | null = null;

function backendValue(existing: CoveragePlanOut) {
  return {
    client: {
      listCoverageGroups: async () => [
        group("g-combo", "combo"),
        group("g-case", "case"),
      ],
      listCoveragePlans: async () => [existing],
      listModels: async () => [],
      getCoverageSettings: async () => ({ bufferTarget: 10 }),
      updateCoveragePlan: async (_id: string, input: CoveragePlanInput) => {
        saved = input;
        return existing;
      },
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

// The plan, its groups and the account's buffer default all resolve asynchronously,
// so every render flushes them before asserting.
async function renderEditor(existing: CoveragePlanOut = plan()) {
  render(
    <MemoryRouter initialEntries={["/account/coverage/p1/edit"]}>
      <BackendProvider value={backendValue(existing)}>
        <GalleryDataProvider value={galleryValue()}>
          <Routes>
            <Route
              path="/account/coverage/:planId/edit"
              element={<CoveragePlanEditPage />}
            />
            {/* Saving navigates back to the plans list, which is not under test. */}
            <Route path="*" element={<div />} />
          </Routes>
        </GalleryDataProvider>
      </BackendProvider>
    </MemoryRouter>,
  );
  await act(async () => {});
}

beforeEach(() => {
  saved = null;
});

// Every setting on this page is a row: its name and one line of description on the
// left, its control on the right, and anything longer behind the help tip. A bare
// checkbox trailed by a paragraph is what the layout replaces.
describe("CoveragePlanEditPage settings", () => {
  const runsPerCell = () =>
    screen.getByLabelText("Runs per cell") as HTMLInputElement;

  it("edits the run target from the row's own control", async () => {
    await renderEditor();
    expect(runsPerCell().value).toBe("3");
    fireEvent.change(runsPerCell(), { target: { value: "5" } });
    expect(runsPerCell().value).toBe("5");
  });

  // The default is not written on the row, so the reset control is the only thing
  // that says the plan is no longer as it came.
  it("offers a reset only once the run target moves off three", async () => {
    await renderEditor();
    expect(
      screen.queryByRole("button", { name: "Reset Runs per cell" }),
    ).toBeNull();
    fireEvent.change(runsPerCell(), { target: { value: "7" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Reset Runs per cell" }),
    );
    expect(runsPerCell().value).toBe("3");
  });

  it("clamps a nonsense run target rather than saving it", async () => {
    await renderEditor();
    fireEvent.change(runsPerCell(), { target: { value: "0" } });
    expect(runsPerCell().value).toBe("1");
    fireEvent.change(runsPerCell(), { target: { value: "9999" } });
    expect(runsPerCell().value).toBe("100");
  });

  it("states the auto-top-up setting as a switch, not a ticked box", async () => {
    await renderEditor();
    const toggle = screen.getByRole("switch", {
      name: "Top up this plan when I submit a review",
    });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  // How a top-up walks the cells is context a reviewer can set the switch without,
  // so it belongs behind the tip rather than in a paragraph under the control.
  it("keeps the long top-up explanation in the help tip", async () => {
    await renderEditor();
    expect(
      screen.getByRole("img", { name: /walks the cells in the run order/i }),
    ).toBeTruthy();
    expect(screen.getByText(/up to the review buffer/i)).toBeTruthy();
  });

  it("saves the settings the rows were left showing", async () => {
    await renderEditor();
    fireEvent.change(runsPerCell(), { target: { value: "4" } });
    fireEvent.click(
      screen.getByRole("switch", {
        name: "Top up this plan when I submit a review",
      }),
    );
    fireEvent.change(screen.getByLabelText("Run order"), {
      target: { value: "combination" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    });
    expect(saved?.runsPerCell).toBe(4);
    expect(saved?.schedule?.autoTopUp).toBe(true);
    expect(saved?.schedule?.outerAxis).toBe("combination");
  });

  // The dashboard owns pausing, and a member edit is not a decision to resume.
  it("carries the paused state through untouched", async () => {
    await renderEditor(plan({ paused: true }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    });
    expect(saved?.schedule?.paused).toBe(true);
  });
});

// A plan's one-off pins are loaded, held and written back by this page untouched. The
// engine is the newest field on a pin and the one nothing here edits, which is exactly
// how it would go missing without anyone noticing.
describe("CoveragePlanEditPage pinned cases", () => {
  it("names a loaded pin's engine, and leaves the engineless one unnamed", async () => {
    await renderEditor(
      plan({
        cases: [
          { slug: "carom", version: "v1.0.0", variant: "base" },
          {
            slug: "carom",
            version: "v1.0.0",
            variant: "base",
            engine: "simple-2d",
          },
        ],
      }),
    );
    // The catalog lists nothing here, so the case name is titled from the slug — the
    // engine is the half under test.
    expect(screen.getByText("Carom · base · v1.0.0")).toBeTruthy();
    expect(screen.getByText("Carom · base · v1.0.0 · Simple 2D")).toBeTruthy();
  });

  it("saves a loaded pin back on the engine it named", async () => {
    await renderEditor(
      plan({
        cases: [
          {
            slug: "carom",
            version: "v1.0.0",
            variant: "base",
            engine: "simple-2d",
          },
        ],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    await act(async () => {});
    expect(saved?.cases).toEqual([
      {
        slug: "carom",
        version: "v1.0.0",
        variant: "base",
        engine: "simple-2d",
      },
    ]);
  });
});
