import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BackendProvider,
  WorkersProvider,
  type BackendContextValue,
  type WorkersContextValue,
} from "../../../client/context";
import type { WorkerClient } from "../../../client/clients";
import type { Model } from "../../../client/types";
import { NewRunPage } from "./NewRunPage";
import {
  blankAgentDraft,
  capabilitySetFromDraft,
  emptyDraft,
} from "./gg/ggConfigDraft";
import { DEFAULT_CAP_IDS } from "./gg/ggCatalog";

// The page's app chrome reads contexts (gallery data, backdrop settings) that are
// irrelevant to the configure/launch logic under test. Stub it so the test
// exercises only the form.
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/PromptHeader", () => ({
  PromptHeader: () => null,
}));
// A local worker needs no sign-in, so auth never gates the launch here — the gating
// stays on the row's configuration + model. The token is present only because an
// account's *saved* gg configurations are read with it (the built-ins need none).
vi.mock("../../../client/auth", () => ({
  useAuth: () => ({ token: "t" }),
}));
// The catalog + case-name hooks pull from the backend/gallery data source; stub
// them with a single already-selected case so the only remaining launch gate is
// the row itself.
vi.mock("../../runtime/useCatalog", () => ({
  useCatalog: () => ({
    cases: [{ slug: "carom", versions: ["v1.0.0"] }],
    slug: "carom",
    version: "v1.0.0",
    variant: "base",
    versionInfo: {
      testType: "end-to-end",
      variants: [{ slug: "base", name: "Base" }],
      maxRuntimeSeconds: 600,
    },
    error: null,
    loading: false,
    noBackend: false,
    setSlug: () => {},
    setVersion: () => {},
    setVariant: () => {},
  }),
}));
vi.mock("../../data/useTestCases", () => ({
  useTestCases: () => ({ testCases: [], status: "ready" }),
}));
vi.mock("../../data/useTestCaseName", () => ({
  useTestCaseName: () => (slug: string) => slug,
}));
// The runs runtime a launch registers its enqueued run with, so the Runs page can
// list it while it is in flight. Hoisted so the mock factory (which vitest lifts
// above the imports) can close over the same spy the tests assert on.
const { track } = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("../../runtime/runsRuntime", () => ({
  useRunsRuntime: () => ({ inProgress: [], track }),
}));

// A catalog entry for a model reachable through *two* harness families, listed
// under a different slug in each — the shape that made the picker commit the wrong
// id. Only the fields the combobox reads are meaningful.
const DUAL_FAMILY_MODEL = {
  slug: "gpt-5-6-sol",
  name: "GPT-5.6 Sol",
  provider: "OpenAI",
  curated: true,
  openrouterUrl: null,
  description: null,
  logoSvg: null,
  coveredModelIds: [],
  aliases: [
    // Deliberately first: the provider-native slug, which OpenRouter rejects.
    { slug: "gpt-5.6-sol", harnessFamily: "codex" },
    { slug: "openai/gpt-5.6-sol", harnessFamily: "openrouter" },
  ],
  price: null,
  priceHistory: [],
  contextLength: null,
  releasedAt: null,
} as unknown as Model;

// A saved configuration exercising the whole model-slot contract: two declared
// launch slots (one carrying a default), an agent deferring to each, and a `judge`
// agent pinned to a model *inside* the configuration — which must never be asked
// about again on the launch form.
const SAVED_CONFIG = {
  id: "cfg-1",
  name: "critic-sweep",
  description: "A reviewer arm.",
  updatedAt: "2026-07-23T00:00:00Z",
  capabilitySet: {
    preset: "critic-sweep",
    modelSlots: [
      { name: "primary" },
      { name: "critic", defaultModelId: "anthropic/claude-haiku-4.5" },
    ],
    agents: [
      {
        name: "Root",
        capabilities: [{ id: "shell", enabled: true, params: {} }],
        modelId: "",
        modelSlot: "primary",
      },
      { name: "reviewer", capabilities: [], modelId: "", modelSlot: "critic" },
      { name: "judge", capabilities: [], modelId: "openai/o-fixed" },
    ],
  },
};

// The account's one saved gg configuration: a single Root agent with the default
// capabilities, deferring to a declared `primary` model slot. There are no shared
// built-ins any more, so a picker has something to offer only because an account saved
// something — which is what these tests set up.
const MINIMAL_DRAFT = (() => {
  const base = emptyDraft();
  const root = blankAgentDraft("Root", DEFAULT_CAP_IDS);
  return {
    ...base,
    agents: [
      {
        ...root,
        id: base.agents[0]!.id,
        modelSource: "model-slot" as const,
        modelSlotId: base.modelSlots[0]!.id,
      },
    ],
  };
})();

const SAVED_GG_CONFIG = {
  id: "cfg-minimal",
  name: "minimal",
  description: "the launchable baseline",
  capabilitySet: capabilitySetFromDraft(MINIMAL_DRAFT, "minimal"),
};

// A backend serving the dual-family catalog and, by default, the account's one saved gg
// configuration — the only kind a picker has to offer.
function backendValue(
  ggConfigs: ReadonlyArray<unknown> = [SAVED_GG_CONFIG],
): BackendContextValue {
  return {
    client: {
      listModels: vi.fn().mockResolvedValue([DUAL_FAMILY_MODEL]),
      listGgConfigs: vi.fn().mockResolvedValue(ggConfigs),
    },
    identity: null,
    status: "ready",
    error: null,
    url: null,
    setUrl: () => {},
  } as unknown as BackendContextValue;
}

// A single local worker: `local: true` means no sign-in is required.
function workersValue(
  launchGgRun: WorkerClient["launchGgRun"] = vi.fn(),
): WorkersContextValue {
  const client = { launchGgRun } as unknown as WorkerClient;
  return {
    workers: [],
    activeId: "local",
    active: {
      id: "local",
      label: "Local",
      url: null,
      local: true,
      client,
      identity: null,
      backendMatch: "unknown",
    },
    setActive: () => {},
    addWorker: () => {},
    removeWorker: () => {},
  } as unknown as WorkersContextValue;
}

function renderPage(
  launchGgRun?: WorkerClient["launchGgRun"],
  ggConfigs?: ReadonlyArray<unknown>,
) {
  return render(
    <MemoryRouter initialEntries={["/runs/new"]}>
      <BackendProvider value={backendValue(ggConfigs)}>
        <WorkersProvider value={workersValue(launchGgRun)}>
          <Routes>
            <Route path="/runs/new" element={<NewRunPage />} />
          </Routes>
        </WorkersProvider>
      </BackendProvider>
    </MemoryRouter>,
  );
}

// Choose gg as the orchestrator — the one control that switches the form into the
// gg run mode.
function chooseGg() {
  fireEvent.change(screen.getByLabelText("Orchestrator"), {
    target: { value: "gg" },
  });
}

describe("NewRunPage", () => {
  beforeEach(() => {
    track.mockClear();
  });

  it("offers harnesses until gg is chosen as the orchestrator", async () => {
    renderPage();
    expect(screen.getByLabelText("Harness")).toBeInTheDocument();
    expect(screen.queryByLabelText("gg configuration")).not.toBeInTheDocument();

    chooseGg();

    // The harness column becomes the gg configuration column, offering what the account
    // has saved — there are no shared built-ins beside them.
    expect(screen.queryByLabelText("Harness")).not.toBeInTheDocument();
    const configs = await screen.findByLabelText("gg configuration");
    expect(configs).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "minimal" }),
    ).toBeInTheDocument();
  });

  it("launches the picked gg configuration with the model bound to its primary slot", async () => {
    const launchGgRun = vi.fn().mockResolvedValue({ jobId: "job-1" });
    renderPage(launchGgRun);
    chooseGg();
    await screen.findByLabelText("gg configuration");

    // gg reaches every slot's model through OpenRouter, so a model catalogued under
    // several families must be bound by its `openrouter` alias — never the
    // Codex-only slug, which OpenRouter answers with a 401/400 rather than a
    // completion.
    const input = await screen.findByPlaceholderText(/^model id/);
    fireEvent.focus(input);
    fireEvent.click(
      await screen.findByRole("option", { name: /GPT-5\.6 Sol/ }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Launch run" }));
    await waitFor(() => expect(launchGgRun).toHaveBeenCalledTimes(1));

    const request = launchGgRun.mock.calls[0]![0];
    expect(request.testCase).toBe("carom");
    // The Root agent resolved to the model picked for its `primary` slot.
    expect(request.capabilitySet.agents[0]).toMatchObject({
      name: "Root",
      modelId: "openai/gpt-5.6-sol",
    });
    // The configuration the picker opened on drove the capability set, and records
    // itself as the run's `preset` facet.
    expect(request.capabilitySet.preset).toBe("minimal");
    const ids = request.capabilitySet.agents[0].capabilities.map(
      (c: { id: string }) => c.id,
    );
    expect(ids).toContain("shell");
    expect(ids).toContain("read-file");
  });

  it("tracks a launched gg run so it appears in the runs list while it is in flight", async () => {
    const launchGgRun = vi.fn().mockResolvedValue({ jobId: "job-3" });
    renderPage(launchGgRun);
    chooseGg();
    await screen.findByLabelText("gg configuration");

    const input = await screen.findByPlaceholderText(/^model id/);
    fireEvent.focus(input);
    fireEvent.click(
      await screen.findByRole("option", { name: /GPT-5\.6 Sol/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Launch run" }));
    await waitFor(() => expect(launchGgRun).toHaveBeenCalledTimes(1));

    // gg has no batch endpoint, so it never travels through `launchBatch` and has
    // to register the enqueued run itself. Its identity is the launched one — the
    // `gg` harness, the configuration it was launched from (what the runs list
    // shows a gg row by, in place of the model), and the model bound to the root
    // agent — so the row reads the same before and after a reload re-seeds the list
    // from the backend.
    await waitFor(() => expect(track).toHaveBeenCalledTimes(1));
    expect(track.mock.calls[0]![0]).toEqual({
      runId: "job-3",
      testCaseSlug: "carom",
      testCaseVersion: "v1.0.0",
      variant: "base",
      harnessSlug: "gg",
      modelId: "openai/gpt-5.6-sol",
      ggPreset: "minimal",
      state: "queued",
    });
  });

  it("does not track a gg run whose launch failed", async () => {
    const launchGgRun = vi.fn().mockRejectedValue(new Error("nope"));
    renderPage(launchGgRun);
    chooseGg();
    await screen.findByLabelText("gg configuration");

    const input = await screen.findByPlaceholderText(/^model id/);
    fireEvent.focus(input);
    fireEvent.click(
      await screen.findByRole("option", { name: /GPT-5\.6 Sol/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Launch run" }));

    await waitFor(() => expect(launchGgRun).toHaveBeenCalledTimes(1));
    await screen.findByText(/nope/);
    expect(track).not.toHaveBeenCalled();
  });

  it("asks only for the configuration's declared model slots, pre-filled with their defaults", async () => {
    const launchGgRun = vi.fn().mockResolvedValue({ jobId: "job-2" });
    renderPage(launchGgRun, [SAVED_CONFIG]);
    chooseGg();
    // Wait for the account's own configurations to land before picking one.
    await screen.findByRole("option", { name: "critic-sweep" });
    fireEvent.change(screen.getByLabelText("gg configuration"), {
      target: { value: "saved:cfg-1" },
    });

    // One picker per declared model slot, labelled by the slot's name — and none for
    // the `judge` role the configuration pinned itself.
    const primary = await screen.findByLabelText("primary");
    const critic = screen.getByLabelText("critic");
    expect(screen.queryByLabelText("judge")).toBeNull();
    // The slot's declared default is pre-filled; the one with no default is empty, so
    // the operator must choose before the run can launch.
    expect(critic).toHaveValue("anthropic/claude-haiku-4.5");
    expect(primary).toHaveValue("");
    expect(screen.getByRole("button", { name: "Launch run" })).toBeDisabled();

    fireEvent.focus(primary);
    fireEvent.click(
      await screen.findByRole("option", { name: /GPT-5\.6 Sol/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Launch run" }));
    await waitFor(() => expect(launchGgRun).toHaveBeenCalledTimes(1));

    // The launched set is fully pinned: each deferred agent resolved to the model its
    // slot collected, the internal `judge` binding carried through untouched, and the
    // declarations dropped — what runs is what the run records.
    const { capabilitySet } = launchGgRun.mock.calls[0]![0];
    expect(
      capabilitySet.agents.map((a: { name: string; modelId: string }) => ({
        name: a.name,
        modelId: a.modelId,
      })),
    ).toEqual([
      { name: "Root", modelId: "openai/gpt-5.6-sol" },
      { name: "reviewer", modelId: "anthropic/claude-haiku-4.5" },
      { name: "judge", modelId: "openai/o-fixed" },
    ]);
    expect(
      capabilitySet.agents.every((a: { modelSlot?: string }) => !a.modelSlot),
    ).toBe(true);
    expect(capabilitySet.modelSlots).toBeUndefined();
  });
});
