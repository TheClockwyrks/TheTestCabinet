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
        modelId: "",
        modelSlot: "primary",
        modelSlots: [{ name: "primary" }],
      },
      {
        id: "k-3c07",
        slug: "reviewer",
        name: "Critic",
        capabilities: [],
        modelId: "",
        modelSlot: "primary",
        modelSlots: [{ name: "primary" }],
      },
      {
        id: "k-2b58",
        slug: "solo",
        name: "Lone critic",
        capabilities: [],
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
    expect(screen.getByRole("option", { name: "minimal" })).toBeInTheDocument();
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
