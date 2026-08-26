import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GG_SYSTEM_PROMPT_TEMPLATE_CODE } from "@test-cabinet/run-record/gg-system-prompt";
import {
  BackendProvider,
  type BackendContextValue,
} from "../../../client/context";
import { GgConfigEditPage } from "./GgConfigEditPage";
import {
  blankAgentDraft,
  blankModelSlot,
  capabilitySetFromDraft,
  emptyDraft,
  seedAgentParams,
} from "../runs/gg/ggConfigDraft";

// The page's app chrome reads contexts (gallery data, backdrop settings) that are
// irrelevant to the editor under test. Stub it, mirroring the other page tests, so
// only the configuration form is exercised.
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
// A signed-in operator: saving a configuration is account-scoped, so the token is
// what unlocks the form.
vi.mock("../../../client/auth", () => ({
  useAuth: () => ({ token: "t0" }),
}));

const createGgConfig = vi.fn().mockResolvedValue({ id: "c1" });
const createGgAgent = vi.fn();
// Whether `GET /gg/agents` answers. A library that fails to load leaves every imported
// profile looking inline, which is the one state the page must refuse to save from.
let listGgAgents = vi.fn();

// The account's agent library. A saved agent is the second way to declare a profile,
// so the picker has something to offer only because an account saved something.
//
// `name` is what the library lists it under, and the slug it is minted with is the slug it
// imports under — nothing is uniquified on the way in, so an entry named "Root" is exactly
// the collision an operator has to resolve.
function savedAgent(id: string, name: string) {
  // Built through the editor's own serializer rather than hand-written, because that is
  // what the library holds: a saved agent is written by this same form, and an agent
  // assembled some other way would be compared against a shape the editor never emits.
  // The slot rides on the profile: a saved agent is one whole agent and nothing else.
  const slot = {
    ...blankModelSlot("critic", true),
    defaultModelId: "anthropic/claude-haiku-4.5",
  };
  const blank = {
    ...blankAgentDraft(name),
    modelSlots: [slot],
    modelSlotId: slot.id,
    customInstructions: "From the library.",
  };
  const agent = seedAgentParams(blank, blank.id);
  const set = capabilitySetFromDraft(
    {
      agents: [agent],
      rootAgentId: agent.id,
      modelSlots: [],
      limits: emptyDraft().limits,
      hooks: [],
    },
    null,
  );
  return {
    id,
    name,
    description: "reviews what the implementer wrote",
    agent: set.agents![0]!,
    updatedAt: "2026-08-18T00:00:00Z",
  };
}

const SAVED_REVIEWER = savedAgent("saved-1", "reviewer");
// The same entry under the name a fresh configuration's first profile already carries, so
// importing it lands on the slug that profile was minted with.
const SAVED_ROOT = savedAgent("saved-root", "Root");

function backendValue(): BackendContextValue {
  return {
    client: {
      listModels: vi.fn().mockResolvedValue([]),
      listGgConfigs: vi.fn().mockResolvedValue([]),
      listGgAgents,
      createGgConfig,
      createGgAgent,
    },
    identity: null,
    status: "ready",
    error: null,
    url: null,
    setUrl: () => {},
  } as unknown as BackendContextValue;
}

beforeEach(() => {
  listGgAgents = vi.fn().mockResolvedValue([SAVED_REVIEWER]);
  createGgAgent.mockReset();
  // The real endpoint stores what it was given and echoes it back, which is what makes
  // the profile that wrote it an import pinning nothing.
  createGgAgent.mockImplementation(
    (input: { description: string; agent: { name: string } }) =>
      Promise.resolve({
        id: "saved-2",
        name: input.agent.name,
        description: input.description,
        agent: input.agent,
        updatedAt: "2026-08-18T00:00:00Z",
      }),
  );
});

// Standing in for the list of configurations, so a test can tell that leaving the
// editor actually left it rather than merely closing a dialog.
const CONFIG_LIST = "the gg configurations list";

function renderPage(path = "/account/gg/new") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BackendProvider value={backendValue()}>
        <Routes>
          <Route path="/account/gg/new" element={<GgConfigEditPage />} />
          <Route path="/account/gg" element={<div>{CONFIG_LIST}</div>} />
        </Routes>
      </BackendProvider>
    </MemoryRouter>,
  );
}

// Open one of the form's tabs by its label. Matched on the label element rather than the
// tab's accessible name, because a tab with something wrong on it also announces the
// count ("Agents, 1 problem").
function openTab(name: string) {
  const tab = screen
    .getAllByRole("tab")
    .find((entry) => entry.firstElementChild?.textContent?.trim() === name);
  if (!tab) throw new Error(`no "${name}" tab`);
  fireEvent.click(tab);
}

// The agent view's two identity fields. They wear one placeholder between them — a slug
// is worth writing as prose the model reads, so "e.g. reviewer" suits both — and are told
// apart by their labels: the name is display text an operator scans, and the slug beneath
// it is the name the *model* is shown and passes back. Neither is what a reference inside
// the configuration holds — that is the profile's internal id, which is on no control here
// because it is nobody's to read or type.
function nameField(): HTMLElement {
  return screen.getByLabelText(/^Agent name/);
}
function slugField(): HTMLElement {
  return screen.getByLabelText(/^Slug/);
}

// Open the (first) agent's per-agent view — where its capabilities, model, prompt, hooks
// and roster live. The agent list is the configuration's Agents tab.
function openFirstAgent() {
  openTab("Agents");
  fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);
}

// Open the first agent and go straight to the tab its capabilities are on.
function openFirstAgentTools() {
  openFirstAgent();
  openTab("Tools");
}

// Import one library entry, from the Agents tab: the button raises the picker, and a row
// in it named by the entry is the import.
function pickFromLibrary(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name: "+ Import agent" }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name }),
  );
}

// Return to the configuration keeping the agent's edits — the only way back other than
// discarding them with Cancel.
function saveAgent() {
  fireEvent.click(screen.getByRole("button", { name: "Save agent" }));
}

describe("GgConfigEditPage", () => {
  // The save spy is module-scoped, so its call log accumulates across tests unless
  // cleared — every "called once" assertion counts from a fresh slate.
  beforeEach(() => createGgConfig.mockClear());

  it("renders the configuration's three sections, capabilities behind an agent", async () => {
    renderPage();
    // The configuration is its identity + the ceilings + the session hooks; the slots
    // and the agent list are the other two sections.
    expect(await screen.findByText("Run limits")).toBeInTheDocument();
    expect(screen.getByText("Session hooks")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. no-compaction")).toBeVisible();

    // The Slots tab is the configuration's **launch inputs** — the slots the agents
    // declare are the agents', and this tab maps one onto the other. The tab strip names
    // the section, so nothing repeats it above the first slot.
    openTab("Slots");
    expect(
      screen.getByRole("button", { name: "+ Add configuration slot" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "+ Add model slot" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Model slots")).not.toBeInTheDocument();
    // A fresh configuration declares none of its own, and a launch still asks for a
    // model: the root's slot is passthrough, so it reaches the form on its own.
    expect(screen.getByText("Exposed at launch")).toBeInTheDocument();
    expect(screen.getByText("root.primary")).toBeInTheDocument();

    // The unremovable Root agent is listed, and capabilities are not on this view.
    openTab("Agents");
    expect(screen.getByText("Root")).toBeInTheDocument();
    expect(screen.queryByText("Shell")).not.toBeInTheDocument();

    // Opening the Root reveals its own sections; its capabilities are one tab in.
    openFirstAgent();
    expect(screen.getByText("Custom instructions")).toBeInTheDocument();
    expect(screen.getByText("System Prompt")).toBeInTheDocument();
    openTab("Tools");
    expect(screen.getByText("Models & tools")).toBeInTheDocument();
    expect(screen.getByText("Shell")).toBeInTheDocument();
    expect(screen.getByText("Filesystem")).toBeInTheDocument();
    // The tab and the section it opens share a name, so both match — which is the point.
    openTab("Roster");
    expect(screen.getAllByText("Roster").length).toBeGreaterThan(1);
    // Multi-model is gone (each agent carries its own model).
    expect(screen.queryByText("Multi-model")).not.toBeInTheDocument();
  });

  it("navigates into an agent and back, hiding the configuration's own controls", async () => {
    renderPage();
    await screen.findByText("Run limits");
    openFirstAgent();
    // An agent is not the configuration: its identity fields and its save go away, and
    // the agent's own pair takes their place.
    expect(nameField()).toBeVisible();
    expect(
      screen.queryByPlaceholderText("e.g. no-compaction"),
    ).not.toBeInTheDocument();
    // The configuration's own save is gone; the back control that returns to it is not
    // (it is how an operator gets there).
    expect(
      screen.queryByRole("button", { name: /^Create configuration$/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Back to / }),
    ).toBeInTheDocument();

    saveAgent();
    // Back on the configuration — on the Agents tab the operator left from, not reset to
    // the first one, so the list they opened the agent out of is what they come back to.
    expect(screen.getByText("Root")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Agent name/)).not.toBeInTheDocument();
    openTab("Configuration");
    expect(screen.getByPlaceholderText("e.g. no-compaction")).toBeVisible();
  });

  it("discards an agent's edits when its editing is cancelled", async () => {
    renderPage();
    await screen.findByText("Run limits");
    openFirstAgent();
    fireEvent.change(nameField(), {
      target: { value: "conductor" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    // The rename never reached the configuration.
    openTab("Agents");
    expect(screen.getByText("Root")).toBeInTheDocument();
    expect(screen.queryByText("conductor")).not.toBeInTheDocument();
  });

  it("reveals a collapsed group's capabilities when expanded", async () => {
    renderPage();
    await screen.findByText("Run limits");
    openFirstAgentTools();
    // "Fork" lives in the Delegation group, which starts collapsed.
    expect(screen.queryByText("Fork")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Delegation/i }));
    expect(screen.getByText("Fork")).toBeInTheDocument();
  });

  it("requires a name, then saves the capability set under it", async () => {
    renderPage();
    expect(
      await screen.findByRole("button", { name: "Create configuration" }),
    ).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("e.g. no-compaction"), {
      target: { value: "shell-heavy" },
    });
    // Turn a capability on, on the root agent, so the saved set is distinguishable.
    openFirstAgentTools();
    fireEvent.click(screen.getAllByRole("checkbox", { name: /Shell/i })[0]!);
    saveAgent();

    const save = screen.getByRole("button", { name: "Create configuration" });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(createGgConfig).toHaveBeenCalledTimes(1));
    const input = createGgConfig.mock.calls[0]![0];
    expect(input.name).toBe("shell-heavy");
    expect(input.capabilitySet.preset).toBe("shell-heavy");
    // A single Root agent, with the full catalog serialized (on or off) so two
    // configurations being compared stay symmetric.
    expect(input.capabilitySet.agents).toHaveLength(1);
    const root = input.capabilitySet.agents[0];
    expect(root.name).toBe("Root");
    const ids = root.capabilities.map((c: { id: string }) => c.id);
    expect(ids).toContain("shell");
    expect(ids).toContain("read-file");
    // The Root defers to the `primary` model slot it declares itself rather than pinning
    // a model, which keeps one configuration reusable across models. The slot is
    // passthrough, so the configuration declares no launch input of its own.
    expect(root.modelId).toBe("");
    expect(root.modelSlot).toBe("primary");
    expect(root.modelSlots).toEqual([{ name: "primary", passthrough: true }]);
    expect(input.capabilitySet.modelSlots).toBeUndefined();
  });

  it("grants a capability's whole offering, less the sub-feature switched off", async () => {
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText("e.g. no-compaction"), {
      target: { value: "no-revise" },
    });
    openFirstAgentTools();
    // Turning Memories on expands its config, where its "Revise memories" slider lives —
    // already on, because switching the capability on granted everything it offers.
    fireEvent.click(screen.getByRole("checkbox", { name: /^Memories/i }));
    const revise = screen.getByRole("checkbox", { name: /Revise memories/i });
    expect(revise).toBeChecked();
    fireEvent.click(revise);
    saveAgent();

    fireEvent.click(
      screen.getByRole("button", { name: "Create configuration" }),
    );
    await waitFor(() => expect(createGgConfig).toHaveBeenCalledTimes(1));
    // The allowlist is per agent, and it is written in the tool vocabulary because this
    // agent answers with tool calls.
    const { tools, operations } =
      createGgConfig.mock.calls[0]![0].capabilitySet.agents[0];
    expect(operations).toBeUndefined();
    // The rest of the capability arrived whole...
    for (const tool of [
      "write_memory",
      "create_memory",
      "read_memory",
      "search_memories",
    ]) {
      expect(tools).toContain(tool);
    }
    // ...and every way a memory is REVISED went with the lever, whichever strategy the run
    // picks — `update_memory` under the scratchpad, `edit_memory` under the two
    // file-shaped ones, and `delete_memory` under all three.
    for (const tool of ["update_memory", "edit_memory", "delete_memory"]) {
      expect(tools).not.toContain(tool);
    }
  });

  it("adds an agent and lets the Root put it on its roster", async () => {
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText("e.g. no-compaction"), {
      target: { value: "delegating" },
    });
    // Add a second agent, then in the Root's view enable it as a subagent with a
    // caller-scoped description.
    openTab("Agents");
    fireEvent.click(screen.getByRole("button", { name: /Add agent/i }));
    openFirstAgent();
    // The roster lists both Root (self) and the new agent-2, each with one toggle per
    // scope. Grant agent-2 the Reviewer scope alone: the scopes are independent, so a
    // reviewer need not also be spawnable.
    openTab("Roster");
    const reviewerToggles = screen.getAllByRole("checkbox", {
      name: /Reviewer/i,
    });
    fireEvent.click(reviewerToggles[reviewerToggles.length - 1]!);
    fireEvent.change(screen.getByPlaceholderText("when to use this agent"), {
      target: { value: "for reviews" },
    });
    saveAgent();

    fireEvent.click(
      screen.getByRole("button", { name: "Create configuration" }),
    );
    await waitFor(() => expect(createGgConfig).toHaveBeenCalledTimes(1));
    const { agents } = createGgConfig.mock.calls[0]![0].capabilitySet;
    expect(agents.map((a: { name: string }) => a.name)).toEqual([
      "Root",
      "agent-2",
    ]);
    // The entry names the target's **internal id** — the one string about a profile that
    // never moves — rather than either of the two names sat beside it on the row.
    expect(agents[1].slug).toBe("agent-2");
    expect(agents[0].subagents).toEqual([
      {
        agentId: agents[1].id,
        description: "for reviews",
        scopes: ["reviewer"],
      },
    ]);
  });

  // The root is a flag, not the name "Root": renaming it has to leave a configuration
  // that still saves, with the renamed profile still written first.
  it("renames the root agent and keeps it the root", async () => {
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText("e.g. no-compaction"), {
      target: { value: "renamed-root" },
    });
    openFirstAgent();
    fireEvent.change(nameField(), {
      target: { value: "conductor" },
    });
    saveAgent();
    expect(screen.getByText("conductor")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Create configuration" }),
    );
    await waitFor(() => expect(createGgConfig).toHaveBeenCalledTimes(1));
    const { agents } = createGgConfig.mock.calls[0]![0].capabilitySet;
    expect(agents.map((a: { name: string }) => a.name)).toEqual(["conductor"]);
  });

  // Handing the root role to another profile reorders the saved set, because gg reads
  // the root off the first agent.
  it("moves the root flag to another agent", async () => {
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText("e.g. no-compaction"), {
      target: { value: "second-root" },
    });
    openTab("Agents");
    fireEvent.click(screen.getByRole("button", { name: /Add agent/i }));
    fireEvent.click(screen.getByRole("button", { name: "Make root" }));

    fireEvent.click(
      screen.getByRole("button", { name: "Create configuration" }),
    );
    await waitFor(() => expect(createGgConfig).toHaveBeenCalledTimes(1));
    const { agents } = createGgConfig.mock.calls[0]![0].capabilitySet;
    expect(agents.map((a: { name: string }) => a.name)).toEqual([
      "agent-2",
      "Root",
    ]);
  });

  // Every agent can be removed, the root included — but a configuration with none of
  // them cannot be saved.
  it("removes the root agent, passing the flag on, and refuses an empty configuration", async () => {
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText("e.g. no-compaction"), {
      target: { value: "shrinking" },
    });
    openTab("Agents");
    fireEvent.click(screen.getByRole("button", { name: /Add agent/i }));
    fireEvent.click(
      screen.getByRole("button", { name: "Remove the Root agent" }),
    );
    // The survivor took the role over, so there is no "Make root" left to offer.
    expect(screen.getByText("agent-2")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Make root" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Create configuration" }),
    ).toBeEnabled();

    fireEvent.click(
      screen.getByRole("button", { name: "Remove the agent-2 agent" }),
    );
    expect(
      screen.getByRole("button", { name: "Create configuration" }),
    ).toBeDisabled();
    expect(screen.getByText(/no agents/i)).toBeInTheDocument();
  });

  // A roster entry points at a profile, not at the spelling of its name, so renaming
  // the target used to break the configuration and now does not.
  it("keeps a roster entry pointed at an agent that is renamed", async () => {
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText("e.g. no-compaction"), {
      target: { value: "renaming" },
    });
    openTab("Agents");
    fireEvent.click(screen.getByRole("button", { name: /Add agent/i }));
    // Put agent-2 on the root's roster …
    openFirstAgent();
    openTab("Roster");
    const reviewerToggles = screen.getAllByRole("checkbox", {
      name: /Reviewer/i,
    });
    fireEvent.click(reviewerToggles[reviewerToggles.length - 1]!);
    saveAgent();
    // … then rename agent-2 out from under it.
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[1]!);
    fireEvent.change(nameField(), {
      target: { value: "critic" },
    });
    saveAgent();

    const save = screen.getByRole("button", { name: "Create configuration" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(createGgConfig).toHaveBeenCalledTimes(1));
    const { agents } = createGgConfig.mock.calls[0]![0].capabilitySet;
    // The rename moved the display name and left the reference where it was: the roster
    // points at the profile's internal id, which no rename of either name touches.
    expect(agents[1].name).toBe("critic");
    expect(agents[1].slug).toBe("agent-2");
    expect(agents[0].subagents).toEqual([
      { agentId: agents[1].id, description: "", scopes: ["reviewer"] },
    ]);
  });

  // A model slot is bound by identity too, so its name is free to change — and it is
  // renamed on the agent that declares it, which is where the slot lives.
  it("keeps an agent bound to a model slot that is renamed", async () => {
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText("e.g. no-compaction"), {
      target: { value: "renamed-slot" },
    });
    openFirstAgent();
    openTab("Slots");
    fireEvent.change(screen.getByLabelText("Slot name"), {
      target: { value: "critic" },
    });
    saveAgent();
    // No "declares no slot" complaint: the binding moved with the name.
    const save = screen.getByRole("button", { name: "Create configuration" });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(createGgConfig).toHaveBeenCalledTimes(1));
    const { agents, modelSlots } =
      createGgConfig.mock.calls[0]![0].capabilitySet;
    // Declared on the profile, and asked for at launch under the name that profile lends
    // it — so the configuration itself still declares nothing.
    expect(agents[0].modelSlots).toEqual([
      { name: "critic", passthrough: true },
    ]);
    expect(agents[0].modelSlot).toBe("critic");
    expect(modelSlots).toBeUndefined();
  });

  // The compaction model is read by the handoff strategies alone, so its box only
  // appears once one of them is selected.
  it("offers the compaction model only under a handoff strategy", async () => {
    renderPage();
    await screen.findByText("Agents");
    openFirstAgentTools();
    fireEvent.click(screen.getByRole("checkbox", { name: /^Compaction/i }));
    expect(
      screen.queryByPlaceholderText("e.g. openai/gpt-4.1-mini"),
    ).not.toBeInTheDocument();

    fireEvent.change(
      screen.getByRole("combobox", { name: /Summarization strategy/i }),
      { target: { value: "handoff-compaction" } },
    );
    expect(
      screen.getByPlaceholderText("e.g. openai/gpt-4.1-mini"),
    ).toBeInTheDocument();
  });

  it("buys the extended prompt-cache lifetime for one agent and leaves the other at the default", async () => {
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText("e.g. no-compaction"), {
      target: { value: "delegating" },
    });
    // A second agent, so the choice is visibly per agent rather than run-wide.
    openTab("Agents");
    fireEvent.click(screen.getByRole("button", { name: "+ Add agent" }));
    openFirstAgent();
    fireEvent.change(screen.getByLabelText(/^Prompt cache/i), {
      target: { value: "extended" },
    });
    saveAgent();
    fireEvent.click(
      screen.getByRole("button", { name: "Create configuration" }),
    );

    await waitFor(() => expect(createGgConfig).toHaveBeenCalledTimes(1));
    const agents = createGgConfig.mock.calls[0]![0].capabilitySet.agents;
    expect(agents[0].promptCacheTtl).toBe("extended");
    // The untouched agent writes no key at all, so it keeps paying the base rate.
    expect(agents[1].promptCacheTtl).toBeUndefined();
  });

  it("stores no system-prompt override unless it is edited", async () => {
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText("e.g. no-compaction"), {
      target: { value: "stock-prompt" },
    });
    openFirstAgent();
    saveAgent();
    fireEvent.click(
      screen.getByRole("button", { name: "Create configuration" }),
    );
    await waitFor(() => expect(createGgConfig).toHaveBeenCalledTimes(1));
    // The default template is seeded into the editor but not stored as an override.
    expect(
      createGgConfig.mock.calls[0]![0].capabilitySet.agents[0]
        .systemPromptTemplate,
    ).toBeUndefined();
  });

  // gg renders one responses-as-code system prompt for every program language: it names
  // no function, so a call's spelling is not in it, and what a model cannot discover
  // about its own language is a segment gg gates while rendering. The program language is
  // therefore an axis of the study and not a prompt selector — picking one must not
  // change what the editor seeds, and editing that seed is editing the one code default.
  it("seeds the one responses-as-code default whatever program language the agent writes", async () => {
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText("e.g. no-compaction"), {
      target: { value: "code-prompt" },
    });
    openFirstAgent();
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "Agent type" })).getByRole(
        "radio",
        { name: "RaC" },
      ),
    );

    openTab("APIs");
    const language = within(
      screen.getByRole("group", { name: "Responses as code" }),
    ).getByLabelText(/^Program language/) as HTMLSelectElement;
    fireEvent.change(language, { target: { value: "rust" } });
    expect(
      (
        within(
          screen.getByRole("group", { name: "Responses as code" }),
        ).getByLabelText(/^Program language/) as HTMLSelectElement
      ).value,
    ).toBe("rust");

    openTab("Agent");
    const promptToggle = screen.getByRole("button", { name: /System Prompt/ });
    fireEvent.click(promptToggle);
    const promptGroup = promptToggle.parentElement!;
    expect(
      (within(promptGroup).getByRole("textbox") as HTMLTextAreaElement).value,
    ).toBe(DEFAULT_GG_SYSTEM_PROMPT_TEMPLATE_CODE);
    // Seeded, not stored — the agent that touched nothing still saves no override.
    expect(within(promptGroup).getByText("default")).toBeInTheDocument();

    saveAgent();
    fireEvent.click(
      screen.getByRole("button", { name: "Create configuration" }),
    );
    await waitFor(() => expect(createGgConfig).toHaveBeenCalledTimes(1));
    expect(
      createGgConfig.mock.calls[0]![0].capabilitySet.agents[0]
        .systemPromptTemplate,
    ).toBeUndefined();
  });
});

// The back chevron beside the title goes up exactly one step. While an agent is open that
// step is the **configuration**, not the list of configurations — the list is two steps up
// and leaving for it would throw away the whole configuration rather than this agent's
// edits. It behaves like Cancel, except that it asks first when there is something to lose.
describe("going back from an open agent", () => {
  beforeEach(() => createGgConfig.mockClear());

  // The back control, which is a button (not a link) while an agent is open.
  function backControl() {
    return screen.getByRole("button", { name: /^Back to / });
  }

  it("returns to the configuration without asking when nothing was edited", async () => {
    renderPage();
    await screen.findByText("Run limits");
    openFirstAgent();
    expect(nameField()).toBeVisible();

    fireEvent.click(backControl());
    // Straight back — an unedited agent has nothing to decide about.
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByText("Root")).toBeInTheDocument();
  });

  it("asks before discarding an edited agent, and keeps editing if told to", async () => {
    renderPage();
    await screen.findByText("Run limits");
    openFirstAgent();
    fireEvent.change(nameField(), {
      target: { value: "conductor" },
    });

    fireEvent.click(backControl());
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeInTheDocument();

    // "Keep editing" is the safe way out: it leaves the agent open, edits intact.
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Keep editing" }),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(nameField()).toHaveValue("conductor");
  });

  it("discards the agent's edits when told to", async () => {
    renderPage();
    await screen.findByText("Run limits");
    openFirstAgent();
    fireEvent.change(nameField(), {
      target: { value: "conductor" },
    });

    fireEvent.click(backControl());
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Discard changes",
      }),
    );
    // Back on the configuration, and the rename never reached it.
    openTab("Agents");
    expect(screen.getByText("Root")).toBeInTheDocument();
    expect(screen.queryByText("conductor")).not.toBeInTheDocument();
  });

  it("saves the agent when told to, keeping the edits on the configuration", async () => {
    renderPage();
    await screen.findByText("Run limits");
    openFirstAgent();
    fireEvent.change(nameField(), {
      target: { value: "conductor" },
    });

    fireEvent.click(backControl());
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Save agent",
      }),
    );
    // Back on the configuration with the rename kept — the dialog's Save is the same
    // commit the Save agent button performs.
    openTab("Agents");
    expect(screen.getByText("conductor")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("refuses to save an agent that is not well-formed, and says why", async () => {
    renderPage();
    await screen.findByText("Run limits");
    openFirstAgent();
    // An agent with no name cannot be committed; the dialog must not offer a Save that
    // silently does nothing.
    fireEvent.change(nameField(), {
      target: { value: "" },
    });

    fireEvent.click(backControl());
    const dialog = screen.getByRole("alertdialog");
    expect(
      within(dialog).getByRole("button", { name: "Save agent" }),
    ).toBeDisabled();
    expect(within(dialog).getByText(/needs a name/i)).toBeInTheDocument();
    // Discarding is still open to them, and puts the agent back as it was.
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Discard changes" }),
    );
    openTab("Agents");
    expect(screen.getByText("Root")).toBeInTheDocument();
  });
});

// The configuration's own back control leaves for the list of configurations, and asks
// the same question an open agent's does — through the same dialog. Two prompts for one
// question (a browser `confirm` here, a component dialog one step in) made a single form
// read as two, and only one of them could offer "save and go" at all.
describe("going back from the configuration", () => {
  beforeEach(() => createGgConfig.mockClear());

  // The back control on the configuration itself, which is a button rather than a link
  // because leaving has to wait for the dialog's answer.
  function backControl() {
    return screen.getByRole("button", { name: "All gg configurations" });
  }

  it("leaves without asking when nothing was edited", async () => {
    renderPage();
    await screen.findByText("Run limits");

    fireEvent.click(backControl());
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByText(CONFIG_LIST)).toBeInTheDocument();
  });

  it("asks before discarding an edited configuration, and keeps editing if told to", async () => {
    renderPage();
    await screen.findByText("Run limits");
    fireEvent.change(screen.getByPlaceholderText("e.g. no-compaction"), {
      target: { value: "no-shell" },
    });

    fireEvent.click(backControl());
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Keep editing" }),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. no-compaction")).toHaveValue(
      "no-shell",
    );
  });

  it("discards the configuration when told to", async () => {
    renderPage();
    await screen.findByText("Run limits");
    fireEvent.change(screen.getByPlaceholderText("e.g. no-compaction"), {
      target: { value: "no-shell" },
    });

    fireEvent.click(backControl());
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Discard changes",
      }),
    );
    expect(screen.getByText(CONFIG_LIST)).toBeInTheDocument();
    expect(createGgConfig).not.toHaveBeenCalled();
  });

  // The third way out the browser's own prompt could never offer: commit the work and
  // leave, in one press.
  it("saves and leaves when told to", async () => {
    renderPage();
    await screen.findByText("Run limits");
    fireEvent.change(screen.getByPlaceholderText("e.g. no-compaction"), {
      target: { value: "no-shell" },
    });

    fireEvent.click(backControl());
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Create configuration",
      }),
    );
    await waitFor(() => expect(createGgConfig).toHaveBeenCalledTimes(1));
    expect(createGgConfig.mock.calls[0]![0].name).toBe("no-shell");
    expect(await screen.findByText(CONFIG_LIST)).toBeInTheDocument();
  });

  // A configuration that cannot be saved must not offer a Save that silently does
  // nothing — the same refusal the agent dialog makes, said in the same place.
  it("refuses to save a configuration that is not well-formed, and says why", async () => {
    renderPage();
    await screen.findByText("Run limits");
    // A name is what makes a configuration savable; typing one and taking it away
    // again leaves the form dirty *and* unsavable.
    const nameField = screen.getByPlaceholderText("e.g. no-compaction");
    fireEvent.change(nameField, { target: { value: "no-shell" } });
    openTab("Agents");
    fireEvent.click(
      screen.getByRole("button", { name: /^Remove the .* agent$/ }),
    );

    fireEvent.click(backControl());
    const dialog = screen.getByRole("alertdialog");
    expect(
      within(dialog).getByRole("button", { name: "Create configuration" }),
    ).toBeDisabled();
    expect(within(dialog).getByText(/at least one agent/i)).toBeInTheDocument();
  });
});

// Importing a saved agent into a configuration.
//
// The overlay's arithmetic is tested in `ggAgentLibrary.test.ts` and its controls in
// `GgConfigEditor.test.tsx`. What only the page shows is what actually reaches the
// account: gg is handed a whole agent, and the provenance rides beside it.
describe("a configuration that imports a saved agent", () => {
  beforeEach(() => createGgConfig.mockClear());

  async function importReviewer() {
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText("e.g. no-compaction"), {
      target: { value: "review arm" },
    });
    openTab("Agents");
    pickFromLibrary(/^reviewer/);
    saveAgent();
  }

  it("saves the agent written out in full, beside where it came from", async () => {
    await importReviewer();
    fireEvent.click(
      screen.getByRole("button", { name: "Create configuration" }),
    );

    await waitFor(() => expect(createGgConfig).toHaveBeenCalled());
    const [input] = createGgConfig.mock.calls[0]!;
    const reviewer = input.capabilitySet.agents.find(
      (a: { name: string }) => a.name === "reviewer",
    );
    // Whole, because gg resolves nothing: it reads this set as it stands.
    expect(reviewer.customInstructions).toBe("From the library.");
    expect(reviewer.modelSlot).toBe("critic");
    // The slot the saved agent brought with it rides on the profile, with its default —
    // so the configuration declared nothing to make the import launchable.
    expect(reviewer.modelSlots).toEqual([
      {
        name: "critic",
        defaultModelId: "anthropic/claude-haiku-4.5",
        passthrough: true,
      },
    ]);
    expect(input.capabilitySet.modelSlots).toBeUndefined();
    // It arrived under the saved agent's own slug, which nothing uniquified…
    expect(reviewer.slug).toBe("reviewer");
    // …and the provenance beside it, pinning nothing. The link is keyed by the profile's
    // **internal id** — minted for this import and never rewritten — so it survives either
    // end being renamed, and stays unambiguous while two profiles carry one slug.
    expect(input.agentSources).toEqual([
      { profileId: reviewer.id, agentId: "saved-1", overrides: [] },
    ]);
    expect(reviewer.id).not.toBe(reviewer.slug);
  });

  it("records the field an edit pins, and leaves the rest following", async () => {
    await importReviewer();
    openTab("Agents");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[1]!);
    fireEvent.change(
      screen.getByPlaceholderText(/^Extra instructions for this agent/),
      { target: { value: "Be brief." } },
    );
    saveAgent();
    fireEvent.click(
      screen.getByRole("button", { name: "Create configuration" }),
    );

    await waitFor(() => expect(createGgConfig).toHaveBeenCalled());
    const [input] = createGgConfig.mock.calls[0]!;
    const reviewer = input.capabilitySet.agents.find(
      (a: { name: string }) => a.name === "reviewer",
    );
    expect(input.agentSources).toEqual([
      {
        profileId: reviewer.id,
        agentId: "saved-1",
        overrides: ["customInstructions"],
      },
    ]);
  });
});

// Writing a profile to the library, and the one state the page must not save from.
describe("a configuration and the agent library", () => {
  beforeEach(() => createGgConfig.mockClear());

  it("writes an inline profile to the library and follows what it wrote", async () => {
    renderPage();
    await screen.findByPlaceholderText("e.g. no-compaction");
    openFirstAgent();
    fireEvent.click(screen.getByRole("button", { name: "Save to library" }));

    await waitFor(() => expect(createGgAgent).toHaveBeenCalled());
    const [body] = createGgAgent.mock.calls[0]!;
    expect(body.agent.name).toBe("Root");
    // The slot the profile defers to travels *on* it, so importing it elsewhere asks for
    // the same launch input — and the library is sent one whole agent, not two halves.
    expect(body.agent.modelSlots).toEqual([
      { name: "primary", passthrough: true },
    ]);
    expect(body).not.toHaveProperty("modelSlots");
    // And the profile now follows the entry it just wrote, pinning nothing.
    expect(await screen.findByText(/Follows the saved agent/)).toBeVisible();
    expect(screen.getByText("Nothing pinned here yet.")).toBeVisible();
  });

  it("refuses to save at all when the library could not be loaded", async () => {
    listGgAgents = vi.fn().mockRejectedValue(new Error("boom"));
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText("e.g. no-compaction"), {
      target: { value: "review arm" },
    });

    // Saving here would record every imported profile as inline for good, so the page
    // says why rather than writing a configuration that has quietly lost its links.
    expect(
      screen.getByRole("button", { name: "Create configuration" }),
    ).toBeDisabled();
    expect(screen.getByText(/saved agents could not be loaded/)).toBeVisible();
    expect(createGgConfig).not.toHaveBeenCalled();
  });
});

// The **launch inputs** a configuration asks for, which is the one thing neither half of
// the model mapping says on its own: the agents declare the slots their bindings defer to,
// this page's Slots tab declares the inputs that fill them, and a run collects exactly one
// model per input. What only the page shows is what reaches the account — a configuration
// slot is stored with the agent slots it names, and an agent slot that reaches no input at
// all is a binding with nowhere to get a model from, which the page refuses to save.
describe("a configuration's launch inputs", () => {
  beforeEach(() => createGgConfig.mockClear());

  // One line of the Slots tab's "Exposed at launch" summary, by the name the launch form
  // will ask under.
  function launchRow(name: string): HTMLElement {
    return screen.getByText(name, { selector: "code" }).closest("li")!;
  }

  // Clear the passthrough flag on the open agent's one slot, which is what leaves it to a
  // configuration slot to fill. A slot reaches the launch form one way or the other, and
  // never both.
  function clearPassthrough() {
    openTab("Slots");
    fireEvent.click(screen.getByRole("checkbox", { name: /^Passthrough/ }));
    saveAgent();
  }

  it("fills two agents' slots from one launch input, and stores what it fills", async () => {
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText("e.g. no-compaction"), {
      target: { value: "one-model" },
    });
    openTab("Agents");
    fireEvent.click(screen.getByRole("button", { name: "+ Add agent" }));
    for (const row of [0, 1]) {
      fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[row]!);
      clearPassthrough();
      openTab("Agents");
    }

    openTab("Slots");
    fireEvent.click(
      screen.getByRole("button", { name: "+ Add configuration slot" }),
    );
    fireEvent.change(screen.getByLabelText("Slot name"), {
      target: { value: "shared" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Root (root) · primary" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "agent-2 (agent-2) · primary" }),
    );
    // One picker at launch, two agents run off it — which is the whole reason to declare
    // a configuration slot rather than leaving both slots passthrough.
    expect(launchRow("shared")).toHaveTextContent(
      "→ Root (root) · primary, agent-2 (agent-2) · primary",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Create configuration" }),
    );
    await waitFor(() => expect(createGgConfig).toHaveBeenCalledTimes(1));
    const { capabilitySet } = createGgConfig.mock.calls[0]![0];
    // The launch input names the agent slots it fills, by each profile's **internal id**
    // and the name the slot carries on it. The id rather than the slug, because a mapping
    // has to survive either end being renamed and has to name exactly one profile while
    // two of them carry one slug — which is precisely the state an import lands in.
    expect(capabilitySet.modelSlots).toEqual([
      {
        name: "shared",
        targets: [
          { agent: capabilitySet.agents[0].id, slot: "primary" },
          { agent: capabilitySet.agents[1].id, slot: "primary" },
        ],
      },
    ]);
    expect(capabilitySet.agents[0].slug).toBe("root");
    expect(capabilitySet.modelSlots[0].targets[0].agent).not.toBe("root");
    // And each agent still declares its own slot — no longer passthrough, because the
    // configuration slot is what puts a model in it now.
    expect(capabilitySet.agents[0].modelSlots).toEqual([{ name: "primary" }]);
    expect(capabilitySet.agents[1].modelSlots).toEqual([{ name: "primary" }]);
  });

  it("refuses to save an agent slot that reaches no launch input, naming both fixes", async () => {
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText("e.g. no-compaction"), {
      target: { value: "stranded" },
    });
    openFirstAgent();
    clearPassthrough();

    // Nothing fills it and nothing exposes it, so a launch would ask for no model at all
    // and the agent would run on none.
    const save = screen.getByRole("button", { name: "Create configuration" });
    expect(save).toBeDisabled();
    expect(
      screen.getByText(
        /reaches no launch input\. Map a configuration slot onto it, or mark it passthrough\./,
      ),
    ).toBeVisible();
    // Said again on the tab where the mapping is edited, beside the picture it breaks.
    openTab("Slots");
    expect(
      screen.getByText(/reaches no launch input, so its bindings would run/),
    ).toBeVisible();
    expect(screen.getByText(/A launch asks for no model at all/)).toBeVisible();
    expect(createGgConfig).not.toHaveBeenCalled();
  });
});

// A profile's **slug** is the name the model is shown and passes back, and it is the
// operator's to write. Two consequences the page has to hold: renaming one is an edit to
// that one string — nothing inside the configuration points at a slug, so there is no
// reference to carry along — and two profiles answering to one slug is a name the model
// could not read either of them by, so the page refuses to store it.
describe("a configuration's agent slugs", () => {
  beforeEach(() => createGgConfig.mockClear());

  it("renames a profile's slug and leaves every reference to it exactly where it was", async () => {
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText("e.g. no-compaction"), {
      target: { value: "renaming" },
    });
    openTab("Agents");
    fireEvent.click(screen.getByRole("button", { name: "+ Add agent" }));
    // Put agent-2 on the root's roster …
    openFirstAgent();
    openTab("Roster");
    const reviewerToggles = screen.getAllByRole("checkbox", {
      name: /Reviewer/i,
    });
    fireEvent.click(reviewerToggles[reviewerToggles.length - 1]!);
    saveAgent();
    // … then give agent-2 a slug that says what it is for, which is what the model reads.
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[1]!);
    fireEvent.change(slugField(), { target: { value: "critic" } });
    saveAgent();

    fireEvent.click(
      screen.getByRole("button", { name: "Create configuration" }),
    );
    await waitFor(() => expect(createGgConfig).toHaveBeenCalledTimes(1));
    const { agents } = createGgConfig.mock.calls[0]![0].capabilitySet;
    expect(agents[1].slug).toBe("critic");
    // One string moved and nothing else did: the display name the slug was minted from is
    // where it was, and so is the internal id — which is what the roster entry holds, and
    // the whole of what makes a slug free to rewrite.
    expect(agents[1].name).toBe("agent-2");
    expect(agents[1].id).not.toBe("critic");
    expect(agents[0].subagents).toEqual([
      { agentId: agents[1].id, description: "", scopes: ["reviewer"] },
    ]);
  });

  it("refuses to commit a profile under a slug gg could not hold", async () => {
    renderPage();
    await screen.findByText("Run limits");
    openFirstAgent();
    fireEvent.change(slugField(), { target: { value: "Merge Bot" } });

    // The model is shown this name and passes it back, so a slug gg could not hold is a
    // profile gg could never be told to spawn.
    expect(screen.getByRole("button", { name: "Save agent" })).toBeDisabled();
    // Said twice, and deliberately: beside the field it is typed in, and beside the
    // control it disabled, so neither reads as a form that simply stopped working.
    expect(
      screen.getAllByText(/^A slug is lowercase letters and digits/),
    ).toHaveLength(2);
  });
});

// Importing a saved agent under a slug the configuration already uses.
//
// Nothing is uniquified on the way in: a silently renamed import is a profile the
// operator's other configurations, and the model's own roster, no longer agree on. So the
// collision is a state the editor shows and the page refuses to store, rather than one it
// resolves on the operator's behalf.
describe("an import that lands on a slug a profile already carries", () => {
  beforeEach(() => createGgConfig.mockClear());

  // The library holds one entry, saved under the name a fresh configuration's first
  // profile already carries — so it imports under that profile's slug.
  async function importRoot() {
    listGgAgents = vi.fn().mockResolvedValue([SAVED_ROOT]);
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText("e.g. no-compaction"), {
      target: { value: "colliding" },
    });
    openTab("Agents");
    pickFromLibrary(/^Root/);
  }

  it("will not commit the profile, and says which one thing is wrong with it", async () => {
    await importRoot();
    // The import opens on the profile it produced, and that profile cannot be committed:
    // a reference to it would name both.
    expect(screen.getByRole("button", { name: "Save agent" })).toBeDisabled();
    expect(
      screen.getAllByText(
        /^Another agent in this configuration carries this slug/,
      ),
    ).toHaveLength(2);
  });

  it("leaves the configuration unsaveable, naming the two ways out", async () => {
    await importRoot();
    // Cancel keeps the import — it restores the configuration as it stood when the
    // profile was opened, which is with the profile in it.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(
      screen.getByRole("button", { name: "Create configuration" }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        /Two agent profiles carry the same slug.*Rename one of them, or override the imported profile's slug\./,
      ),
    ).toBeVisible();
    // Both of the rows it is about say so, because either one is where it gets fixed.
    openTab("Agents");
    expect(
      screen.getAllByText(/Another profile carries the slug/),
    ).toHaveLength(2);
    expect(createGgConfig).not.toHaveBeenCalled();
  });

  // The first of the two ways out, and the one the operator is already standing in: the
  // import opened on the profile it produced, so the slug field in front of them is the
  // fix. What it must not cost is the import itself — a profile renamed to clear a clash
  // goes on following the saved agent in every field but the one that was retyped, which
  // is why the slug is an overridable field of the overlay rather than an identity the
  // configuration takes ownership of.
  it("is cleared by giving the import a slug of its own, which is then the one field it pins", async () => {
    await importRoot();
    fireEvent.change(slugField(), { target: { value: "reviewer" } });
    saveAgent();

    const save = screen.getByRole("button", { name: "Create configuration" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(createGgConfig).toHaveBeenCalledTimes(1));
    const [input] = createGgConfig.mock.calls[0]!;
    const [root, imported] = input.capabilitySet.agents;
    expect(root.slug).toBe("root");
    expect(imported.slug).toBe("reviewer");
    // Everything else still comes from the library — including the instructions and the
    // slot the saved agent brought, neither of which the rename went near.
    expect(imported.customInstructions).toBe("From the library.");
    expect(imported.modelSlot).toBe("critic");
    expect(input.agentSources).toEqual([
      { profileId: imported.id, agentId: "saved-root", overrides: ["slug"] },
    ]);
  });

  // The other way out, and the reason the message names two: the clash is symmetric, so it
  // is as legitimately cleared by renaming the profile that was already there. Doing it
  // from that side leaves the import carrying the library's own slug — and pinning nothing
  // at all, which is a configuration that follows the saved agent in every field it has.
  it("is cleared just as well from the other side, leaving the import pinning nothing", async () => {
    await importRoot();
    // Cancel keeps the import and returns to the list, which is where the other profile is.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    openTab("Agents");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]!);
    fireEvent.change(slugField(), { target: { value: "conductor" } });
    saveAgent();

    fireEvent.click(
      screen.getByRole("button", { name: "Create configuration" }),
    );
    await waitFor(() => expect(createGgConfig).toHaveBeenCalledTimes(1));
    const [input] = createGgConfig.mock.calls[0]!;
    const [root, imported] = input.capabilitySet.agents;
    expect(root.slug).toBe("conductor");
    expect(imported.slug).toBe("root");
    expect(input.agentSources).toEqual([
      { profileId: imported.id, agentId: "saved-root", overrides: [] },
    ]);
  });
});

// One saved agent imported twice.
//
// Two imports of one library entry are two profiles, not one profile listed twice: each is
// minted an internal id of its own, and every reference — the roster, a slot target, the
// link back to the library, and the editor's own Edit and ✕ — resolves through that id.
// They do arrive under one slug, because nothing is uniquified on the way in, and telling
// them apart again is the operator's one-field rename. What only the page can show is that
// neither of the two is ever the other: opening the second opens *that* profile, editing it
// leaves the first as the library wrote it, and removing one removes one.
describe("one saved agent imported twice", () => {
  beforeEach(() => createGgConfig.mockClear());

  // Two imports of `saved-1` into a fresh configuration, which therefore holds the Root it
  // was born with and two profiles following one library entry. The first import is
  // committed with Save agent; the second cannot be — it is the collision — so it is closed
  // with Cancel, which keeps it.
  async function importReviewerTwice() {
    renderPage();
    fireEvent.change(await screen.findByPlaceholderText("e.g. no-compaction"), {
      target: { value: "two reviewers" },
    });
    openTab("Agents");
    for (const close of ["Save agent", "Cancel"]) {
      pickFromLibrary(/^reviewer/);
      fireEvent.click(screen.getByRole("button", { name: close }));
    }
    openTab("Agents");
  }

  it("yields two profiles under one slug, each opened and edited on its own", async () => {
    await importReviewerTwice();
    // Two rows, both saying they answer to one name…
    expect(
      screen.getAllByText(/Another profile carries the slug/),
    ).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Create configuration" }),
    ).toBeDisabled();

    // …and the second row is a profile of its own: what is typed into it — the rename that
    // clears the clash, and an edit beside it — lands on that profile and no other.
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[2]!);
    fireEvent.change(slugField(), { target: { value: "second-reviewer" } });
    fireEvent.change(
      screen.getByPlaceholderText(/^Extra instructions for this agent/),
      { target: { value: "Be brief." } },
    );
    saveAgent();

    // The first is as the library wrote it, which is what "two profiles" has to mean.
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[1]!);
    expect(slugField()).toHaveValue("reviewer");
    expect(
      screen.getByPlaceholderText(/^Extra instructions for this agent/),
    ).toHaveValue("From the library.");
    saveAgent();

    fireEvent.click(
      screen.getByRole("button", { name: "Create configuration" }),
    );
    await waitFor(() => expect(createGgConfig).toHaveBeenCalledTimes(1));
    const [input] = createGgConfig.mock.calls[0]!;
    const [, first, second] = input.capabilitySet.agents;
    // Told apart by the ids nobody is shown…
    expect(first.id).not.toBe(second.id);
    expect(first.slug).toBe("reviewer");
    expect(second.slug).toBe("second-reviewer");
    // …and each following the same library entry through a link of its own, recording the
    // fields it pins and no other profile's.
    expect(input.agentSources).toEqual([
      { profileId: first.id, agentId: "saved-1", overrides: [] },
      {
        profileId: second.id,
        agentId: "saved-1",
        overrides: ["slug", "customInstructions"],
      },
    ]);
  });

  it("removes one of the two and leaves the other following what it followed", async () => {
    await importReviewerTwice();
    // The rows are told apart on screen by their display names, which is the one thing an
    // import does uniquify — a list of two identical rows is a list nobody can work in.
    fireEvent.click(
      screen.getByRole("button", { name: "Remove the reviewer-2 agent" }),
    );

    // One row left, so nothing shares a slug any more and the configuration saves.
    expect(screen.queryByText(/Another profile carries the slug/)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Create configuration" }),
    );
    await waitFor(() => expect(createGgConfig).toHaveBeenCalledTimes(1));
    const [input] = createGgConfig.mock.calls[0]!;
    const { agents } = input.capabilitySet;
    expect(agents.map((a: { name: string }) => a.name)).toEqual([
      "Root",
      "reviewer",
    ]);
    // And exactly one link, the survivor's: a removal names its row by the internal id, so
    // the profile that stayed still follows the entry it was imported from.
    expect(input.agentSources).toEqual([
      { profileId: agents[1].id, agentId: "saved-1", overrides: [] },
    ]);
  });
});
