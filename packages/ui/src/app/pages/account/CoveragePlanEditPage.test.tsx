import type {
  CoverageGroup,
  CoveragePlanInput,
  CoveragePlanOut,
} from "@clockwyrks/backend-api/coverage";
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendClient } from "../../../client/clients";
import { BackendProvider } from "../../../client/context";
import {
  GalleryDataProvider,
  type GalleryDataInput,
} from "../../data/galleryContext";
import { CoveragePlanEditPage } from "./CoveragePlanEditPage";
import { retryLimitHelp } from "./retry-limit";

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
    filling: false,
    retryCount: 1,
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
      getCoverageSettings: async () => ({
        inFlightLimit: { kind: "bounded", runs: 10 },
      }),
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

  // A nonsense target is refused rather than corrected under the caret: the field
  // keeps what was typed, says what is wrong with it, and the save will not run.
  it("refuses a nonsense run target rather than correcting it", async () => {
    await renderEditor();

    fireEvent.change(runsPerCell(), { target: { value: "0" } });
    expect(runsPerCell().value).toBe("0");
    expect(runsPerCell()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Runs per cell must be 1 or more.")).toBeVisible();
    expect(screen.getByRole("button", { name: /plan$/ })).toBeDisabled();

    fireEvent.change(runsPerCell(), { target: { value: "9999" } });
    expect(runsPerCell().value).toBe("9999");
    expect(
      screen.getByText("Runs per cell must be 100 or less."),
    ).toBeVisible();
  });

  // The report this was built for: "3" could not be replaced by "5" without
  // selecting it, because clearing the field snapped it back to 1.
  it("can be cleared and retyped, and will not save while it is empty", async () => {
    await renderEditor();

    fireEvent.change(runsPerCell(), { target: { value: "" } });
    expect(runsPerCell().value).toBe("");
    expect(screen.getByText("Runs per cell is required.")).toBeVisible();
    expect(screen.getByRole("button", { name: /plan$/ })).toBeDisabled();

    fireEvent.change(runsPerCell(), { target: { value: "5" } });
    expect(runsPerCell().value).toBe("5");
    expect(screen.queryByText("Runs per cell is required.")).toBeNull();
    expect(screen.getByRole("button", { name: /plan$/ })).not.toBeDisabled();
  });

  it("offers no auto top-up setting: reviews and edits never launch runs", async () => {
    await renderEditor();
    expect(screen.queryByRole("switch", { name: /top.up/i })).toBeNull();
    expect(screen.queryByText(/review buffer/i)).toBeNull();
    expect(screen.getByText("Runs in flight at once")).toBeTruthy();
  });

  it("saves the settings the rows were left showing", async () => {
    await renderEditor();
    fireEvent.change(runsPerCell(), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Run order"), {
      target: { value: "combination" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    });
    expect(saved?.runsPerCell).toBe(4);
    expect(saved?.outerAxis).toBe("combination");
    expect(saved).not.toHaveProperty("schedule");
  });

  it("saves no limit as the unbounded shape, not as a large bound", async () => {
    await renderEditor();
    fireEvent.click(screen.getByRole("switch", { name: "No limit" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    });
    expect(saved?.inFlightLimit).toEqual({ kind: "unbounded" });
  });

  it("loads an unbounded override back as the switch, and drops it on reset", async () => {
    await renderEditor(plan({ inFlightLimit: { kind: "unbounded" } }));
    const toggle = screen.getByRole("switch", { name: "No limit" });
    expect((toggle as HTMLInputElement).checked).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Reset Runs in flight at once" }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    });
    expect(saved?.inFlightLimit).toBeUndefined();
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

function retryLimit() {
  return screen.getByLabelText<HTMLInputElement>("Retry limit");
}

// The retry limit: how many automatic retries each run launched gets. A whole number
// from 0 to 10 that a new plan starts at 1 on, held as typed and refused out of range.
describe("CoveragePlanEditPage retry limit", () => {
  it("starts a new plan at one retry", async () => {
    render(
      <MemoryRouter initialEntries={["/account/coverage/new"]}>
        <BackendProvider value={backendValue(plan())}>
          <GalleryDataProvider value={galleryValue()}>
            <Routes>
              <Route
                path="/account/coverage/new"
                element={<CoveragePlanEditPage />}
              />
            </Routes>
          </GalleryDataProvider>
        </BackendProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByLabelText("Retry limit")).toHaveValue(1);
  });

  it("loads the saved limit and saves it back", async () => {
    await renderEditor(plan({ retryCount: 4 }));
    expect(retryLimit()).toHaveValue(4);
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    await waitFor(() => {
      expect(saved?.retryCount).toBe(4);
    });
  });

  it("saves zero as zero: retries turned off, not the default", async () => {
    await renderEditor();
    expect(retryLimit()).toHaveValue(1);
    fireEvent.change(retryLimit(), { target: { value: "0" } });
    expect(retryLimit()).not.toHaveAttribute("aria-invalid", "true");
    fireEvent.click(screen.getByRole("button", { name: "Save plan" }));
    await waitFor(() => {
      expect(saved?.retryCount).toBe(0);
    });
  });

  it("refuses a limit outside 0 to 10 rather than correcting it", async () => {
    await renderEditor();
    const saveButton = screen.getByRole("button", { name: "Save plan" });

    fireEvent.change(retryLimit(), { target: { value: "11" } });
    expect(retryLimit()).toHaveValue(11);
    expect(retryLimit()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Retry limit must be 10 or less.")).toBeVisible();
    expect(saveButton).toBeDisabled();

    fireEvent.change(retryLimit(), { target: { value: "-1" } });
    expect(screen.getByText("Retry limit must be 0 or more.")).toBeVisible();
    expect(saveButton).toBeDisabled();

    fireEvent.change(retryLimit(), { target: { value: "1.5" } });
    expect(retryLimit()).toHaveAttribute("aria-invalid", "true");
    expect(saveButton).toBeDisabled();

    fireEvent.click(saveButton);
    expect(saved).toBeNull();

    fireEvent.change(retryLimit(), { target: { value: "10" } });
    expect(saveButton).toBeEnabled();
  });

  it("offers a reset once the limit moves off one, and says what blocks", async () => {
    await renderEditor();
    expect(
      screen.queryByRole("button", { name: "Reset Retry limit" }),
    ).not.toBeInTheDocument();
    fireEvent.change(retryLimit(), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset Retry limit" }));
    expect(retryLimit()).toHaveValue(1);
    expect(
      screen.getByText(
        "How many times a failed run is retried automatically before its result stands.",
      ),
    ).toBeInTheDocument();
    expect(retryLimitHelp("plan")).toMatch(
      /0 turns retries off\. A run that uses its retries up without a result that counts blocks its cell until it is retried by hand\./,
    );
  });
});
