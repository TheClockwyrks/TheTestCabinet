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
import { DEFAULT_CAP_IDS, DEFAULT_OPENING_TURN } from "./gg/ggCatalog";

// The page's app chrome reads contexts (gallery data, backdrop settings) that are
// irrelevant to the configure/launch logic under test. Stub it so the test
// exercises only the form.
vi.mock("../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/PromptHeader", () => ({
  // The header's chrome is not what these tests are about; its slots are, because a
  // page's own actions live in them. Stub the chrome and pass the slots through, so a
  // control that moves into the header does not silently vanish from the test.
  PromptHeader: ({
    titleActions,
    actions,
  }: {
    titleActions?: ReactNode;
    actions?: ReactNode;
  }) => (
    <>
      {titleActions}
      {actions}
    </>
  ),
}));
// Signed in, so auth never gates the launch here — the gating stays on the row's
// configuration + model. The token also reads the account's *saved* gg
// configurations (the built-ins need none).
vi.mock("../../../client/auth", () => ({
  useAuth: () => ({ token: "t" }),
}));
// The catalog + case-name hooks pull from the backend/gallery data source; stub
// them with a single already-selected case so the only remaining launch gate is
// the row itself.
// The engines the stubbed version reports as supported. Held in a hoisted box so a
// test can stand the selected case up as one supporting a choice of engine — the
// picker is offered off the resolved version, so that set is the only input that
// decides whether the field exists at all.
const { supportedEngines, catalogLoading } = vi.hoisted(() => ({
  supportedEngines: { current: ["none"] as string[] },
  catalogLoading: { current: false },
}));
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
      engines: supportedEngines.current,
    },
    error: null,
    loading: catalogLoading.current,
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

// A saved configuration exercising the whole model-slot contract, which is now two
// kinds of launch input at once:
//
//   * a **configuration slot** (`shared`) filling the slots two agents declare, so one
//     picker at launch decides what both of them run on — the whole reason to declare one;
//   * a **passthrough** agent slot, which the launch form asks for on its own under the
//     name the agent that declares it lends it (`solo.primary`);
//   * and a `judge` agent pinned to a model *inside* the configuration, which must never
//     be asked about again on the launch form.
//
// This is an **authored** set, so each profile spells its identity in all three of the ways
// that identity is now split: an opaque internal `id` nobody is shown, a `slug` the operator
// wrote and the model reads, and a free-form `name`. The three are deliberately different
// text on every profile here, because everything this fixture is for turns on which of them
// a given place uses — a configuration slot's `targets[].agent` names the **id**, while the
// launch form labels a passthrough slot by the **slug**, and neither is the name.
const SAVED_CONFIG = {
  id: "cfg-1",
  name: "critic-sweep",
  description: "A reviewer arm.",
  updatedAt: "2026-07-23T00:00:00Z",
  // Every agent is declared inline, so the configuration follows no saved agent.
  agentSources: [],
  capabilitySet: {
    preset: "critic-sweep",
    modelSlots: [
      {
        name: "shared",
        // By internal id, which is what a reference inside an authored configuration is:
        // renaming either profile leaves this pointing at the same two agents.
        targets: [
          { agent: "k-9f21", slot: "primary" },
          { agent: "k-3c07", slot: "primary" },
        ],
      },
    ],
    agents: [
      {
        id: "k-9f21",
        slug: "root",
        name: "Root",
        capabilities: [{ id: "shell", enabled: true, params: {} }],
        openingTurn: {
          modules: [...DEFAULT_OPENING_TURN.modules],
          functions: [...DEFAULT_OPENING_TURN.functions],
        },
        modelId: "",
        modelSlot: "primary",
        modelSlots: [{ name: "primary" }],
      },
      {
        id: "k-3c07",
        slug: "reviewer",
        name: "Critic",
        capabilities: [],
        openingTurn: {
          modules: [...DEFAULT_OPENING_TURN.modules],
          functions: [...DEFAULT_OPENING_TURN.functions],
        },
        modelId: "",
        modelSlot: "primary",
        modelSlots: [{ name: "primary" }],
      },
      {
        id: "k-2b58",
        slug: "solo",
        name: "Lone critic",
        capabilities: [],
        openingTurn: {
          modules: [...DEFAULT_OPENING_TURN.modules],
          functions: [...DEFAULT_OPENING_TURN.functions],
        },
        modelId: "",
        modelSlot: "primary",
        modelSlots: [
          {
            name: "primary",
            passthrough: true,
            defaultModelId: "anthropic/claude-haiku-4.5",
          },
        ],
      },
      {
        id: "k-77d4",
        slug: "judge",
        name: "Judge",
        capabilities: [],
        openingTurn: {
          modules: [...DEFAULT_OPENING_TURN.modules],
          functions: [...DEFAULT_OPENING_TURN.functions],
        },
        modelId: "openai/o-fixed",
      },
    ],
  },
};

// The account's one saved gg configuration: a single Root agent with the default
// capabilities, deferring to the passthrough `primary` slot it declares itself. There are
// no shared built-ins any more, so a picker has something to offer only because an account
// saved something — which is what these tests set up.
const MINIMAL_DRAFT = (() => {
  const base = emptyDraft();
  const root = blankAgentDraft("Root", DEFAULT_CAP_IDS);
  // A fresh profile is born declaring and deferring to its own passthrough `primary`
  // slot, so there is no configuration-level declaration to point it at.
  return { ...base, agents: [{ ...root, id: base.agents[0]!.id }] };
})();

const SAVED_GG_CONFIG = {
  id: "cfg-minimal",
  name: "minimal",
  description: "the launchable baseline",
  capabilitySet: capabilitySetFromDraft(MINIMAL_DRAFT, "minimal"),
  agentSources: [],
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

// A single worker; the mocked account's token clears the sign-in gate.
function workersValue(
  launchGgRun: WorkerClient["launchGgRun"] = vi.fn(),
  launchRunBatch: WorkerClient["launchRunBatch"] = vi.fn(),
): WorkersContextValue {
  const client = { launchGgRun, launchRunBatch } as unknown as WorkerClient;
  return {
    workers: [],
    activeId: "local",
    active: {
      id: "local",
      label: "Local",
      url: "https://worker.example",
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
  launchRunBatch?: WorkerClient["launchRunBatch"],
  // A case detail page's Run action arrives with the anchored coordinate in the
  // query string; tests covering that seed pass the full entry here.
  initialEntry = "/runs/new",
) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <BackendProvider value={backendValue(ggConfigs)}>
        <WorkersProvider value={workersValue(launchGgRun, launchRunBatch)}>
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
    // Every test but the engine ones runs against a case supporting the engineless
    // run alone, which is what a case that declares no engine supports.
    supportedEngines.current = ["none"];
    catalogLoading.current = false;
  });

  it("refuses to launch while the selected version is still resolving", async () => {
    // A case or version switch leaves the previous version's variants and engines on
    // screen until the new one resolves. Launching in that window enqueues the case
    // now selected against a variant and an engine that belong to the one it
    // replaced, and both are gated by the case: the run is refused in the driver pod,
    // long after the operator has left the form.
    supportedEngines.current = ["none", "simple-2d"];
    catalogLoading.current = true;
    const launchRunBatch = vi.fn();
    renderPage(undefined, undefined, launchRunBatch);

    fireEvent.change(await screen.findByPlaceholderText(/^model id/), {
      target: { value: "claude-opus-4-8" },
    });

    expect(screen.getByRole("button", { name: "Launch run" })).toBeDisabled();
    expect(launchRunBatch).not.toHaveBeenCalled();
  });

  // The report this was built for: "1" could not be replaced by "5" without
  // selecting it or driving the spinner, because clearing the field snapped it
  // back to 1 under the caret.
  it("lets the run count be cleared and retyped, and refuses to launch while it is empty", async () => {
    const launchRunBatch = vi.fn().mockResolvedValue([{ runId: "run-1" }]);
    renderPage(undefined, undefined, launchRunBatch);
    fireEvent.change(await screen.findByPlaceholderText(/^model id/), {
      target: { value: "claude-opus-4-8" },
    });

    const runCount = screen.getByLabelText("Run count") as HTMLInputElement;
    expect(runCount.value).toBe("1");

    fireEvent.change(runCount, { target: { value: "" } });
    expect(runCount.value).toBe("");
    expect(screen.getByText("Run count is required.")).toBeVisible();
    expect(screen.getByRole("button", { name: /^Launch/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /^Launch/ }));
    expect(launchRunBatch).not.toHaveBeenCalled();

    fireEvent.change(runCount, { target: { value: "5" } });
    expect(runCount.value).toBe("5");
    fireEvent.click(screen.getByRole("button", { name: "Launch 5 runs" }));
    await waitFor(() => expect(launchRunBatch).toHaveBeenCalledTimes(1));
    expect(launchRunBatch.mock.calls[0]![0]).toHaveLength(5);
  });

  it("refuses to launch on a run count outside the range it enqueues", async () => {
    const launchRunBatch = vi.fn();
    renderPage(undefined, undefined, launchRunBatch);
    fireEvent.change(await screen.findByPlaceholderText(/^model id/), {
      target: { value: "claude-opus-4-8" },
    });

    const runCount = screen.getByLabelText("Run count") as HTMLInputElement;
    fireEvent.change(runCount, { target: { value: "999" } });
    // Held as typed rather than clamped to the ceiling behind the operator's back.
    expect(runCount.value).toBe("999");
    expect(screen.getByText("Run count must be 20 or less.")).toBeVisible();
    expect(screen.getByRole("button", { name: /^Launch/ })).toBeDisabled();
    expect(launchRunBatch).not.toHaveBeenCalled();
  });

  it("lets the retry count be cleared, and refuses to launch until it is answered", async () => {
    const launchRunBatch = vi.fn();
    renderPage(undefined, undefined, launchRunBatch);
    fireEvent.change(await screen.findByPlaceholderText(/^model id/), {
      target: { value: "claude-opus-4-8" },
    });

    const retries = screen.getByLabelText("Retry count") as HTMLInputElement;
    fireEvent.change(retries, { target: { value: "" } });
    expect(retries.value).toBe("");
    expect(screen.getByText("Retry count is required.")).toBeVisible();
    expect(screen.getByRole("button", { name: /^Launch/ })).toBeDisabled();

    // Zero is an answer — retries off — and is not the same as no answer at all.
    fireEvent.change(retries, { target: { value: "0" } });
    expect(screen.getByRole("button", { name: /^Launch/ })).not.toBeDisabled();
  });

  // The one field here an empty entry may be launched on: empty means "use the
  // case's own ceiling". Text that names no number is still refused, rather than
  // reaching the request as a NaN.
  it("launches on an empty max runtime but not on a nonsense one", async () => {
    const launchRunBatch = vi.fn().mockResolvedValue([{ runId: "run-1" }]);
    renderPage(undefined, undefined, launchRunBatch);
    fireEvent.change(await screen.findByPlaceholderText(/^model id/), {
      target: { value: "claude-opus-4-8" },
    });

    const maxRuntime = screen.getByLabelText(
      "Max runtime (s, optional)",
    ) as HTMLInputElement;
    expect(maxRuntime.value).toBe("");
    expect(screen.getByRole("button", { name: /^Launch/ })).not.toBeDisabled();

    fireEvent.change(maxRuntime, { target: { value: "0" } });
    expect(screen.getByRole("button", { name: /^Launch/ })).toBeDisabled();

    fireEvent.change(maxRuntime, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /^Launch/ }));
    await waitFor(() => expect(launchRunBatch).toHaveBeenCalledTimes(1));
    expect(launchRunBatch.mock.calls[0]![0][0]).not.toHaveProperty(
      "maxRuntimeSeconds",
    );
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
    expect(screen.getByRole("option", { name: "minimal" })).toBeInTheDocument();
  });

  it("offers an engine only where the resolved version supports more than one", async () => {
    // A case that supports the engineless run alone has already decided its engine,
    // so there is nothing to ask. The field's whole existence is the resolved
    // version's answer.
    const { unmount } = renderPage();
    expect(screen.queryByLabelText("Engine")).not.toBeInTheDocument();
    unmount();

    supportedEngines.current = ["none", "simple-2d"];
    renderPage();
    const engine = screen.getByLabelText("Engine");
    expect(engine).toBeInTheDocument();
    // Offered in catalog order, leading with the engineless run, and opening on it.
    expect(
      Array.from(engine.querySelectorAll("option")).map((o) => o.textContent),
    ).toEqual(["None", "Simple 2D"]);
    expect((engine as HTMLSelectElement).value).toBe("none");
  });

  it("launches a harness run on the picked engine", async () => {
    // The engine is a run dimension the case gates, so a run that fails to carry the
    // operator's selection is not the run they asked for — it is an engineless run
    // of a case that may not even support one.
    supportedEngines.current = ["none", "simple-2d"];
    const launchRunBatch = vi.fn().mockResolvedValue([{ runId: "run-1" }]);
    renderPage(undefined, undefined, launchRunBatch);

    fireEvent.change(screen.getByLabelText("Engine"), {
      target: { value: "simple-2d" },
    });
    // The harness row's model is typed rather than picked: the combobox scopes its
    // catalog to the harness's family, and what the run carries is the id either way.
    fireEvent.change(await screen.findByPlaceholderText(/^model id/), {
      target: { value: "claude-opus-4-8" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Launch run" }));
    await waitFor(() => expect(launchRunBatch).toHaveBeenCalledTimes(1));

    const configs = launchRunBatch.mock.calls[0]![0];
    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({
      testCase: "carom",
      variant: "base",
      engine: "simple-2d",
    });
  });

  it("launches a gg run on the picked engine", async () => {
    // A gg run seeds and builds a workspace like any other run, so it carries the
    // engine dimension too.
    supportedEngines.current = ["none", "simple-2d"];
    const launchGgRun = vi.fn().mockResolvedValue({ jobId: "job-2" });
    renderPage(launchGgRun);
    chooseGg();
    await screen.findByLabelText("gg configuration");

    fireEvent.change(screen.getByLabelText("Engine"), {
      target: { value: "simple-2d" },
    });
    const input = await screen.findByPlaceholderText(/^model id/);
    fireEvent.focus(input);
    fireEvent.click(
      await screen.findByRole("option", { name: /GPT-5\.6 Sol/ }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Launch run" }));
    await waitFor(() => expect(launchGgRun).toHaveBeenCalledTimes(1));
    expect(launchGgRun.mock.calls[0]![0].engine).toBe("simple-2d");
  });

  it("seeds the engine choice from the ?engine= param", async () => {
    // A case detail page's Run action carries its whole anchored coordinate,
    // engine included, so the form must open on exactly the rendering that was
    // being viewed rather than the engineless default.
    supportedEngines.current = ["none", "simple-2d"];
    renderPage(
      undefined,
      undefined,
      undefined,
      "/runs/new?slug=carom&version=v1.0.0&variant=base&engine=simple-2d",
    );

    expect((screen.getByLabelText("Engine") as HTMLSelectElement).value).toBe(
      "simple-2d",
    );
  });

  it("holds an unsupported ?engine= param to what the version offers", async () => {
    // A stale link may name an engine the resolved version does not support; the
    // existing derived-engine guard resolves it to a supported one, so the seed
    // must never let the form launch what the case would refuse.
    supportedEngines.current = ["none", "simple-2d"];
    renderPage(
      undefined,
      undefined,
      undefined,
      "/runs/new?slug=carom&version=v1.0.0&variant=base&engine=voxel-3d",
    );

    expect((screen.getByLabelText("Engine") as HTMLSelectElement).value).toBe(
      "none",
    );
  });

  it("falls back to an engine the resolved version supports", async () => {
    // A case built against a runtime need not offer the engineless run at all, so the
    // form's default is not a safe assumption: an unsupported selection would be
    // refused when the run executes, after the operator had left the form.
    supportedEngines.current = ["simple-2d"];
    const launchRunBatch = vi.fn().mockResolvedValue([{ runId: "run-2" }]);
    renderPage(undefined, undefined, launchRunBatch);

    // One supported engine, so nothing is asked — and the launch still names it.
    expect(screen.queryByLabelText("Engine")).not.toBeInTheDocument();
    fireEvent.change(await screen.findByPlaceholderText(/^model id/), {
      target: { value: "claude-opus-4-8" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Launch run" }));
    await waitFor(() => expect(launchRunBatch).toHaveBeenCalledTimes(1));
    expect(launchRunBatch.mock.calls[0]![0][0].engine).toBe("simple-2d");
  });

  it("launches the picked gg configuration with the model bound to its root's slot", async () => {
    const launchGgRun = vi.fn().mockResolvedValue({ jobId: "job-1" });
    renderPage(launchGgRun);
    chooseGg();
    await screen.findByLabelText("gg configuration");

    // A configuration that declares no launch input of its own still asks for a model:
    // the root's slot is passthrough, so the form asks for it under the name the agent
    // that declares it lends it.
    expect(await screen.findByLabelText("root.primary")).toBeInTheDocument();

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
    // The configuration the picker opened on drove the capability set: it records its
    // name as the run's `preset` facet, and its id as `presetId` — what the run is
    // attributed to, so a hand-launched run counts against the same coverage cell a
    // scheduled one does.
    expect(request.capabilitySet.preset).toBe("minimal");
    expect(request.capabilitySet.presetId).toBe("cfg-minimal");
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
      // The engine it was launched on, so the row is filtered with the runs of the
      // cell it belongs to while it is still in flight.
      engine: "none",
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

  it("asks for exactly one model per launch input, pre-filled with its default", async () => {
    const launchGgRun = vi.fn().mockResolvedValue({ jobId: "job-2" });
    renderPage(launchGgRun, [SAVED_CONFIG]);
    chooseGg();
    // Wait for the account's own configurations to land before picking one.
    await screen.findByRole("option", { name: "critic-sweep" });
    fireEvent.change(screen.getByLabelText("gg configuration"), {
      target: { value: "saved:cfg-1" },
    });

    // A run asks for exactly one set of models: the configuration's own slots, then every
    // passthrough agent slot under the name the agent that declares it lends it. Two
    // inputs here for four agents — three of them bound, two off one picker — and none
    // for the `judge` role the configuration pinned itself.
    const shared = await screen.findByLabelText("shared");
    const solo = screen.getByLabelText("solo.primary");
    expect(screen.queryByLabelText("judge")).toBeNull();
    // And in that order — every configuration slot as the configuration declared them,
    // then the passthrough agent slots. The order is the operator's, so a form that
    // reshuffled it would make a configuration impossible to write instructions about.
    expect(
      screen
        .getAllByPlaceholderText(/^model id/)
        .map(
          (input) => input.closest("label")!.querySelector("span")!.textContent,
        ),
    ).toEqual(["shared", "solo.primary"]);
    // Nothing is asked under a bare slot name: `primary` is what three of these agents
    // call their own slot, and one picker per binding would be three pickers.
    expect(screen.queryByLabelText("primary")).toBeNull();
    // The passthrough input is labelled by its agent's **slug** and by nothing else. The
    // operator wrote that slug, the model is shown it, and it is what the run will name
    // the profile by afterwards — so it is the one half of the profile's identity worth
    // reading on a form. The display name is prose that two profiles may share, and the
    // internal id is opaque text minted for references and shown to nobody; a form
    // labelled by either would be asking about an agent the operator cannot place.
    expect(screen.queryByLabelText("Lone critic.primary")).toBeNull();
    expect(screen.queryByLabelText("k-2b58.primary")).toBeNull();
    // The input's declared default is pre-filled; the one with no default is empty, so
    // the operator must choose before the run can launch.
    expect(solo).toHaveValue("anthropic/claude-haiku-4.5");
    expect(shared).toHaveValue("");
    expect(screen.getByRole("button", { name: "Launch run" })).toBeDisabled();

    fireEvent.focus(shared);
    fireEvent.click(
      await screen.findByRole("option", { name: /GPT-5\.6 Sol/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Launch run" }));
    await waitFor(() => expect(launchGgRun).toHaveBeenCalledTimes(1));

    // The launched set is fully pinned: each deferred agent resolved to the model the
    // launch input filling its slot collected — the two off `shared` running on one — the
    // internal `judge` binding carried through untouched, and every declaration dropped.
    //
    // The two `shared` agents are the half of this that proves the second level was
    // resolved through the ids: the declaration named `k-9f21` and `k-3c07`, not `root`
    // and `reviewer`, and nothing but reading the targets as ids gets both of them onto
    // the one model the operator picked.
    const { capabilitySet } = launchGgRun.mock.calls[0]![0];
    expect(
      capabilitySet.agents.map(
        (a: { slug: string; name: string; modelId: string }) => ({
          slug: a.slug,
          name: a.name,
          modelId: a.modelId,
        }),
      ),
    ).toEqual([
      { slug: "root", name: "Root", modelId: "openai/gpt-5.6-sol" },
      { slug: "reviewer", name: "Critic", modelId: "openai/gpt-5.6-sol" },
      {
        slug: "solo",
        name: "Lone critic",
        modelId: "anthropic/claude-haiku-4.5",
      },
      { slug: "judge", name: "Judge", modelId: "openai/o-fixed" },
    ]);
    // Nothing is left for gg to resolve: it is handed a set whose bindings are decided.
    expect(
      capabilitySet.agents.every(
        (a: { modelSlot?: string; modelSlots?: unknown[] }) =>
          !a.modelSlot && !a.modelSlots,
      ),
    ).toBe(true);
    expect(capabilitySet.modelSlots).toBeUndefined();
    // The internal ids ride along untouched. Binding models is not what resolves a
    // profile's identity: the console posts the set as it was authored, ids and all, and
    // the backend is the one place that rewrites every reference onto the slug and drops
    // them — which is also the last place a reference can still be judged against the ids
    // it names.
    expect(capabilitySet.agents.map((a: { id?: string }) => a.id)).toEqual([
      "k-9f21",
      "k-3c07",
      "k-2b58",
      "k-77d4",
    ]);
  });
});
