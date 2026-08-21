// The gg configuration editor — its **per-agent form**, and the configuration's own
// sections around it — on the things it has to get right about a control that is not
// always meaningful, and about which profile a control is acting on.
//
// 1. An agent's **type** decides what the form offers at all: a capability only one type
//    reads is listed only under that type, and a machine — which has no capabilities of
//    its own — is offered none. Switching type has to be free (nothing is lost until the
//    agent is committed), which is a thing only rendering the form and driving it shows.
// 2. A param the selected strategy does not read is not offered. The catalog says which
//    implementations each param applies under (`ParamSpec.showWhenImplementation`), but the
//    only thing that proves an operator is not staring at a box that changes nothing is
//    rendering the form and looking. A stale, ignored ceiling sitting beside a live one is
//    exactly the kind of thing that gets set, saved, and then blamed for a run's behavior.
// 3. A `model` param binds like every other model in the configuration — from a model slot
//    the launch form fills in, or pinned here. That control is two fields that swap, and
//    which one is showing is decided by whether the param's slot key is *present* in the
//    draft, which is a distinction no unit test of the draft can see.
// 4. A profile is opened, patched and removed by its **internal id**, while everything an
//    operator or a model reads of it is its **slug** — and two profiles carrying one slug
//    is a state the editor deliberately lets an operator reach. Only driving the form
//    shows that both of them stay separately addressable while it lasts, and that a
//    rename moves the one name and nothing else.

import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { GgSavedAgent } from "@test-cabinet/run-record/gg";
import { GgConfigEditor } from "./GgConfigEditor";
import {
  BUILT_IN_SKILL_OPTIONS,
  LOOP_DETECTION_SPECS,
  authoredImplementation,
  capabilitySpec,
  type GgAgentMode,
} from "./ggCatalog";
import {
  blankAgentDraft,
  blankModelSlot,
  capabilitySetFromDraft,
  emptyDraft,
  seedAgentParams,
  statesDraftValue,
  type GgConfigDraft,
} from "./ggConfigDraft";

// The editor is controlled, so a test drives it through a tiny stateful host rather than
// re-rendering by hand — which is also how the pages use it.
function Harness({ initial }: { initial: GgConfigDraft }) {
  const [draft, setDraft] = useState(initial);
  return (
    <GgConfigEditor
      value={draft}
      onChange={setDraft}
      name="under test"
      onNameChange={() => {}}
      description=""
      onDescriptionChange={() => {}}
      editingAgentId={initial.agents[0]!.id}
      onEditingAgentChange={() => {}}
      models={[]}
    />
  );
}

// The same host, opened on the **configuration** rather than on an agent — which is what
// the page shows until an agent is opened.
function ConfigHarness({ initial }: { initial: GgConfigDraft }) {
  const [draft, setDraft] = useState(initial);
  return (
    <GgConfigEditor
      value={draft}
      onChange={setDraft}
      name="under test"
      onNameChange={() => {}}
      description=""
      onDescriptionChange={() => {}}
      editingAgentId={null}
      onEditingAgentChange={() => {}}
      models={[]}
    />
  );
}

// Open one of the form's tabs by its label. Matched on the label element rather than the
// tab's accessible name, because a tab with something wrong on it also announces the
// count ("States, 1 problem") — which is the point of the badge, and would make an exact
// name match here depend on whether the section under test happens to be complete.
function openTab(name: string) {
  const tab = screen
    .getAllByRole("tab")
    .find((entry) => entry.firstElementChild?.textContent?.trim() === name);
  if (!tab) throw new Error(`no "${name}" tab`);
  fireEvent.click(tab);
}

// Render the agent form and open the tab its capabilities are on — "Tools" under a
// tool-calling agent, "APIs" under a code one. Most of this file is about a capability's
// controls, and the capabilities are one tab in from where the form opens.
function renderCaps(initial: GgConfigDraft) {
  const rendered = render(<Harness initial={initial} />);
  openTab(initial.agents[0]!.mode === "rac" ? "APIs" : "Tools");
  return rendered;
}

// A draft with one agent, opened on that agent's form, of the given type (Tools unless
// said otherwise), with `capId` enabled and carrying `params` over the values a
// switched-on capability is written with. `implementation` names the arm; the empty string
// is the arm a freshly switched-on capability selects, which is the only reading of an
// empty implementation the form has left.
function draftWith(
  capId: string,
  implementation: string,
  params: Record<string, string> = {},
  mode: GgAgentMode = "tools",
): GgConfigDraft {
  const draft = emptyDraft();
  const agent = draft.agents[0]!;
  return {
    ...draft,
    agents: [
      {
        ...agent,
        mode,
        capabilities: {
          ...agent.capabilities,
          [capId]: {
            ...agent.capabilities[capId]!,
            enabled: true,
            implementation:
              implementation || authoredImplementation(capabilitySpec(capId)!),
            params: { ...agent.capabilities[capId]!.params, ...params },
          },
        },
      },
    ],
  };
}

// The agent-type selector's segment for a type, by the label it wears.
function typeSegment(label: string): HTMLElement {
  return within(
    screen.getByRole("radiogroup", { name: "Agent type" }),
  ).getByRole("radio", { name: label });
}

// Pick an option on a <select> the way an operator would — the editor is controlled, so
// this is the only way its state advances.
function select(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } });
}

// One capability's row in the open agent's form, found by the capability id printed beside
// its name.
function capabilityRow(capId: string): HTMLElement {
  const id = screen.getByText(capId, { selector: "span" });
  const row = id.closest("div");
  if (!row) throw new Error(`no row around the ${capId} capability`);
  return row;
}

describe("a param the selected strategy does not read", () => {
  it("is hidden under the shell capability's inline mode and shown under the others", () => {
    renderCaps(draftWith("shell", ""));
    const row = capabilityRow("shell");

    // The default mode truncates, so both ceilings are live controls.
    expect(within(row).getByLabelText(/^Max lines/)).toBeDefined();
    expect(within(row).getByLabelText(/^Max characters/)).toBeDefined();

    select(within(row).getByLabelText(/^Output mode/), "inline");
    expect(within(row).queryByLabelText(/^Max lines/)).toBeNull();
    expect(within(row).queryByLabelText(/^Max characters/)).toBeNull();

    select(within(row).getByLabelText(/^Output mode/), "offload");
    expect(within(row).getByLabelText(/^Max lines/)).toBeDefined();
  });

  it("is hidden while read-file is unlimited, which reads no line cap at all", () => {
    renderCaps(draftWith("read-file", ""));
    const row = capabilityRow("read-file");

    expect(within(row).queryByLabelText(/^Line cap/)).toBeNull();
    select(within(row).getByLabelText(/^Read mode/), "default-cap");
    expect(within(row).getByLabelText(/^Line cap/)).toBeDefined();
  });

  it("follows the memory strategy, which reads a different subset of the limits", () => {
    renderCaps(draftWith("memories", ""));
    const row = capabilityRow("memories");

    // Scratchpad: the window carries the notes, so the total-length budget is the live one
    // and there is neither an index nor a search to bound.
    expect(within(row).getByLabelText(/^Max length total/)).toBeDefined();
    expect(within(row).queryByLabelText(/^Max index length/)).toBeNull();
    expect(within(row).queryByLabelText(/^Max search results/)).toBeNull();

    select(within(row).getByLabelText(/^Memory strategy/), "markdown");
    expect(within(row).getByLabelText(/^Max index length/)).toBeDefined();
    expect(within(row).queryByLabelText(/^Max length total/)).toBeNull();
    // A markdown run is bounded by its index, not by a count of notes.
    expect(within(row).queryByLabelText(/^Max memories/)).toBeNull();

    select(within(row).getByLabelText(/^Memory strategy/), "keyword-search");
    expect(within(row).getByLabelText(/^Max search results/)).toBeDefined();
    expect(within(row).getByLabelText(/^Max memories/)).toBeDefined();
    expect(within(row).queryByLabelText(/^Max index length/)).toBeNull();
  });

  it("keeps what a hidden control held, so switching strategy loses nothing", () => {
    renderCaps(draftWith("shell", "offload", { maxLines: "40" }));
    const row = capabilityRow("shell");
    expect(
      (within(row).getByLabelText(/^Max lines/) as HTMLInputElement).value,
    ).toBe("40");

    select(within(row).getByLabelText(/^Output mode/), "inline");
    select(within(row).getByLabelText(/^Output mode/), "offload");
    expect(
      (within(row).getByLabelText(/^Max lines/) as HTMLInputElement).value,
    ).toBe("40");
  });
});

// An agent's **type** is not a capability, and the whole point of the selector is that
// the rest of the form changes with it: the type decides which **tabs** the agent even
// has (a machine's States, a code agent's APIs against a tool agent's Tools), and
// responses-as-code and the state machine are the type's own settings rather than rows in
// a capability list. None of that is visible without rendering the form and driving the
// selector.
describe("an agent's type", () => {
  // The tabs an agent currently offers, by their labels.
  function tabNames(): string[] {
    return screen
      .getAllByRole("tab")
      .map((tab) => tab.firstElementChild?.textContent?.trim() ?? "");
  }

  it("is chosen on the Agent tab, and says what the choice means", () => {
    render(<Harness initial={emptyDraft()} />);
    expect(typeSegment("Tools")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/Tool calling: gg offers/)).toBeInTheDocument();

    fireEvent.click(typeSegment("RaC"));
    expect(typeSegment("RaC")).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText(/One turn can make dozens of calls/),
    ).toBeInTheDocument();
  });

  // The tab set is the clearest statement of what a type *is*: the same capabilities met
  // as tools or as APIs, and a machine that has neither because it takes no turns.
  it("decides which sections the agent has at all", () => {
    render(<Harness initial={emptyDraft()} />);
    expect(tabNames()).toEqual(["Agent", "Tools", "Slots", "Roster", "Hooks"]);

    fireEvent.click(typeSegment("RaC"));
    expect(tabNames()).toEqual(["Agent", "APIs", "Slots", "Roster", "Hooks"]);

    fireEvent.click(typeSegment("FSM"));
    expect(tabNames()).toEqual(["Agent", "States"]);
  });

  it("offers responses-as-code as the type's settings, not as a capability", () => {
    render(<Harness initial={emptyDraft()} />);
    // Under Tools it is not on the page at all — it is the other type.
    expect(
      screen.queryByRole("group", { name: "Responses as code" }),
    ).toBeNull();

    fireEvent.click(typeSegment("RaC"));
    openTab("APIs");
    const panel = screen.getByRole("group", { name: "Responses as code" });
    // Its params are the same controls a capability's are…
    expect(
      within(panel).getByRole("group", { name: "Documentation types" }),
    ).toBeDefined();
    // …but it has no switch of its own: the type selector is the switch.
    expect(
      screen.queryByText("responses-as-code", { selector: "span" }),
    ).toBeNull();
  });

  it("lists a capability only the code type reads only under it", () => {
    render(<Harness initial={emptyDraft()} />);
    openTab("Tools");
    // There are no programs in a tool-calling session to keep.
    expect(
      screen.queryByText("program-library", { selector: "span" }),
    ).toBeNull();

    openTab("Agent");
    fireEvent.click(typeSegment("RaC"));
    openTab("APIs");
    expect(
      screen.getByText("program-library", { selector: "span" }),
    ).toBeInTheDocument();
  });

  it("offers a machine no capabilities at all — its configuration is the machine", () => {
    render(<Harness initial={emptyDraft()} />);
    openTab("Tools");
    expect(screen.getByText("shell", { selector: "span" })).toBeInTheDocument();

    openTab("Agent");
    fireEvent.click(typeSegment("FSM"));
    // Neither section exists to open, so there is nowhere a capability could be listed.
    expect(tabNames()).not.toContain("Tools");
    expect(tabNames()).not.toContain("APIs");
    expect(screen.queryByText("shell", { selector: "span" })).toBeNull();
    openTab("States");
    expect(
      screen.getByRole("group", { name: "State machine" }),
    ).toBeInTheDocument();
  });

  // A machine takes no turns, so it runs no model, keeps no cache, renders no prompt and
  // spawns from no roster. None of those controls is shown under one — a field an
  // operator can set and gg would never read is worse than no field, because it invites
  // them to configure a run that does not exist.
  it("asks a machine for no model, prompt or roster", () => {
    render(<Harness initial={emptyDraft()} />);
    expect(screen.getByLabelText("Model from")).toBeInTheDocument();

    fireEvent.click(typeSegment("FSM"));
    for (const label of ["Model from", "Model slot", "Prompt cache"]) {
      expect(screen.queryByLabelText(label)).toBeNull();
    }
    expect(screen.queryByText("Custom instructions")).toBeNull();
    expect(screen.queryByText("System Prompt")).toBeNull();
    // Nobody to spawn, and no lifecycle of its own to gate.
    expect(tabNames()).not.toContain("Roster");
    expect(tabNames()).not.toContain("Hooks");

    // …and they are all back the moment it is a worker again.
    fireEvent.click(typeSegment("Tools"));
    expect(screen.getByLabelText("Model from")).toBeInTheDocument();
    expect(tabNames()).toContain("Roster");
  });

  // Switching type is a look, not an edit: an operator comparing the two arms of a study
  // must be able to flip between them without the form quietly forgetting what the one
  // they flipped away from was set to. (The wind-back to a type's defaults happens when
  // the agent is *committed*, which is the page's job and is covered in the draft tests.)
  it("keeps what another type was configured with while the agent is open", () => {
    renderCaps(draftWith("shell", ""));
    const shell = capabilityRow("shell");
    select(within(shell).getByLabelText(/^Output mode/), "inline");

    openTab("Agent");
    fireEvent.click(typeSegment("RaC"));
    openTab("APIs");
    const panel = screen.getByRole("group", { name: "Responses as code" });
    const errors = docViewTypeBox(panel, "errors");
    expect(errors.checked).toBe(true);
    fireEvent.click(errors);

    openTab("Agent");
    fireEvent.click(typeSegment("Tools"));
    openTab("Tools");
    expect(
      (
        within(capabilityRow("shell")).getByLabelText(
          /^Output mode/,
        ) as HTMLSelectElement
      ).value,
    ).toBe("inline");

    openTab("Agent");
    fireEvent.click(typeSegment("RaC"));
    openTab("APIs");
    expect(
      docViewTypeBox(
        screen.getByRole("group", { name: "Responses as code" }),
        "errors",
      ).checked,
    ).toBe(false);
  });
});

/** One `docViewTypes` checkbox by the flag id its label opens with. */
function docViewTypeBox(panel: HTMLElement, flag: string): HTMLInputElement {
  const group = within(panel).getByRole("group", {
    name: "Documentation types",
  });
  return (within(group).getAllByRole("checkbox") as HTMLInputElement[]).find(
    (box) => box.parentElement?.textContent?.startsWith(flag),
  )!;
}

// The responses-as-code documentation types are three ungated toggles — the type has no
// implementations, so the control is offered whenever the agent is a code agent. The
// catalog entry is the whole of this feature's UI, so rendering the form is the only
// thing that says the generic param grid picked it up: a flag that never appears is an
// arm of the study an operator can only reach by hand-editing the configuration's JSON.
//
// The draft value is the list of types switched OFF, and a saved configuration names all
// three whichever way they sit — so what a checkbox does is only visible by rendering it
// and clicking.
describe("the responses-as-code documentation types", () => {
  it("opens a fresh capability with `parameters` off and the other two on", () => {
    renderCaps(draftWith("responses-as-code", "", {}, "rac"));
    const panel = screen.getByRole("group", { name: "Responses as code" });
    expect(docViewTypeBox(panel, "return").checked).toBe(true);
    expect(docViewTypeBox(panel, "errors").checked).toBe(true);
    const parameters = docViewTypeBox(panel, "parameters");
    expect(parameters.checked).toBe(false);
    // The checkbox is the whole readout of which way it sits; why this one differs from
    // the other two is on hover, where every member's reason lives.
    expect(parameters.parentElement).toHaveAttribute(
      "title",
      expect.stringContaining("starts switched off"),
    );
  });

  it("holds a stored configuration and moves one flag without moving the rest", () => {
    renderCaps(
      draftWith("responses-as-code", "", { docViewTypes: "return" }, "rac"),
    );
    const panel = screen.getByRole("group", { name: "Responses as code" });
    expect(docViewTypeBox(panel, "return").checked).toBe(false);
    expect(docViewTypeBox(panel, "parameters").checked).toBe(true);

    const errors = docViewTypeBox(panel, "errors");
    fireEvent.click(errors);
    expect(docViewTypeBox(panel, "errors").checked).toBe(false);
    expect(docViewTypeBox(panel, "return").checked).toBe(false);
    expect(docViewTypeBox(panel, "parameters").checked).toBe(true);
  });
});

describe("a capability param that names a model", () => {
  // The compaction model is the one model in a configuration that is not an agent's own
  // binding, and it has to be pickable at launch like every other one — otherwise a
  // configuration meant to sweep the summarizer across models has to be edited per run.
  const handoff = (params: Record<string, string> = {}) =>
    draftWith("compaction", "handoff-summarization", params);

  // The slots a `model` param may defer to are the **agent's own**: a model slot belongs
  // to the profile whose bindings name it, and the configuration's own slots are launch
  // inputs that fill those rather than a second list to bind against. Passthrough, so the
  // declaration is one a launch would actually ask about.
  function withSlot(draft: GgConfigDraft): GgConfigDraft {
    const agent = draft.agents[0]!;
    return {
      ...draft,
      agents: [
        {
          ...agent,
          modelSlots: [...agent.modelSlots, blankModelSlot("summarizer", true)],
        },
      ],
    };
  }

  it("offers a model slot beside a pinned model, and swaps the field with it", () => {
    renderCaps(withSlot(handoff()));
    const row = capabilityRow("compaction");

    // A param carrying no slot key is a pinned model, so the model field is showing.
    expect(within(row).getByLabelText(/^Model$/)).toBeDefined();
    expect(within(row).queryByLabelText(/^Model slot/)).toBeNull();

    select(within(row).getByLabelText(/^Model from/), "model-slot");
    const slot = within(row).getByLabelText(/^Model slot/) as HTMLSelectElement;
    // The list is this agent's own declarations, and deferring lands on the first of them
    // rather than on "(none)": an operator who chose to defer meant to defer to something.
    expect(
      within(slot)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["primary", "summarizer"]);
    expect(within(slot).queryByRole("option", { name: "(none)" })).toBeNull();
    expect(within(row).queryByLabelText(/^Model$/)).toBeNull();
  });

  it("says so when it defers to no slot, which a run could never fill in", () => {
    // An agent declaring no slots at all: deferring cannot pick one. The configuration's
    // own slots are no help here — they fill an agent's declarations rather than standing
    // in for them — so a profile that declares nothing has nothing to defer to.
    const draft = handoff();
    renderCaps({
      ...draft,
      agents: [{ ...draft.agents[0]!, modelSlots: [], modelSlotId: "" }],
    });
    const row = capabilityRow("compaction");

    select(within(row).getByLabelText(/^Model from/), "model-slot");
    expect(within(row).getByText(/would never fill it in/)).toBeDefined();
  });

  it("is not offered at all under a strategy that condenses on the agent's own model", () => {
    renderCaps(withSlot(handoff()));
    const row = capabilityRow("compaction");
    expect(within(row).getByLabelText(/^Model from/)).toBeDefined();

    select(
      within(row).getByLabelText(/^Summarization strategy/),
      "self-compaction",
    );
    expect(within(row).queryByLabelText(/^Model from/)).toBeNull();
  });
});

// A gg **process** — a machine over the configuration's other agent profiles — is the
// one capability whose param is a document rather than a value, and the whole reason
// the module model exists is authored on its edges. It is also the surface where "too
// tedious to use" and "does not exist" are the same thing: an author who has to hand-
// write JSON to say `explore → build, carrying the conversation` will write a single
// agent instead. So the tests here are the operator's actual moves — add a state, point
// it at an agent, add an edge, pick what it carries, rename a state — plus the two
// launch failures gg would otherwise report only after the run had started.
describe("authoring a state machine", () => {
  // A configuration whose Root is a machine over two worker profiles, seeded with
  // `states` (the state rows name the workers by their local ids, as the draft holds
  // every cross-reference).
  function machineDraft(
    states: (workers: [string, string]) => ReadonlyArray<{
      name: string;
      agentId: string;
      transitions: Array<{
        to: string;
        transfer: Array<"history" | "tasks">;
        description: string;
      }>;
    }>,
  ): GgConfigDraft {
    const base = emptyDraft();
    const explorer = blankAgentDraft("Explorer");
    const builder = blankAgentDraft("Builder");
    const shell = {
      ...base.agents[0]!,
      name: "Feature",
      mode: "fsm" as const,
      capabilities: {
        ...base.agents[0]!.capabilities,
        fsm: {
          enabled: true,
          params: {
            states: statesDraftValue([...states([explorer.id, builder.id])]),
          },
          extraParams: {},
        },
      },
    };
    return { ...base, agents: [shell, explorer, builder] };
  }

  // A machine is the FSM type's whole configuration, and it has a tab to itself — there
  // is no capability group to expand first, only the section to open.
  function openMachine(draft: GgConfigDraft) {
    render(<Harness initial={draft} />);
    openTab("States");
    return screen.getByRole("group", { name: "State machine" });
  }

  const LINEAR = (workers: [string, string]) => [
    {
      name: "explore",
      agentId: workers[0],
      transitions: [
        {
          to: "build",
          transfer: ["history" as const],
          description: "when you understand the change",
        },
      ],
    },
    { name: "build", agentId: workers[1], transitions: [] },
  ];

  it("adds a state and points it at one of the configuration's agents", () => {
    const row = openMachine(machineDraft(LINEAR));
    fireEvent.click(within(row).getByRole("button", { name: "+ Add state" }));

    const name = within(row).getByLabelText("State 3 name") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "verify" } });
    expect(
      (within(row).getByLabelText("State 3 name") as HTMLInputElement).value,
    ).toBe("verify");

    // Until it names an agent the machine will not launch, and the form says so where
    // the fix is rather than at save time.
    expect(within(row).getByText(/runs no agent/)).toBeInTheDocument();
    const agent = within(row).getByLabelText("State 3 agent");
    fireEvent.change(agent, {
      target: {
        value: (
          within(row).getByLabelText("State 1 agent") as HTMLSelectElement
        ).value,
      },
    });
    expect(within(row).queryByText(/runs no agent/)).toBeNull();
    // A state with no edges ends the machine, and is marked as such rather than
    // reading as an unfinished row.
    expect(within(row).getAllByText("terminal").length).toBe(2);
  });

  it("opens a new edge carrying the conversation, and records what it carries", () => {
    const row = openMachine(machineDraft(LINEAR));
    fireEvent.click(
      within(row).getByRole("button", { name: /Add transition from build/ }),
    );

    const transfer = within(row).getByRole("group", {
      name: "State 2 transition 1 transfer",
    });
    // Pre-filled with History — the common case, still written down in the record.
    expect(within(transfer).getByLabelText("History")).toBeChecked();
    expect(within(transfer).getByLabelText("Tasks")).not.toBeChecked();

    fireEvent.click(within(transfer).getByLabelText("Tasks"));
    expect(within(transfer).getByLabelText("Tasks")).toBeChecked();

    // Clearing every module is a legitimate hard reset, and says so — an empty row of
    // checkboxes otherwise reads as an unfinished edge.
    fireEvent.click(within(transfer).getByLabelText("History"));
    fireEvent.click(within(transfer).getByLabelText("Tasks"));
    expect(within(row).getByText(/carries nothing/)).toBeInTheDocument();
  });

  it("carries a renamed state's inbound edges with it", () => {
    const row = openMachine(machineDraft(LINEAR));
    const target = within(row).getByLabelText(
      "State 1 transition 1 target",
    ) as HTMLSelectElement;
    expect(target.value).toBe("build");

    fireEvent.change(within(row).getByLabelText("State 2 name"), {
      target: { value: "assemble" },
    });
    // The edge followed the rename; the machine is still one gg would launch.
    expect(
      (
        within(row).getByLabelText(
          "State 1 transition 1 target",
        ) as HTMLSelectElement
      ).value,
    ).toBe("assemble");
    expect(within(row).queryByText(/not a state it declares/)).toBeNull();
  });

  it("moves the entry state, which is a position rather than a flag", () => {
    const row = openMachine(machineDraft(LINEAR));
    expect(
      (within(row).getByLabelText("State 1 name") as HTMLInputElement).value,
    ).toBe("explore");

    fireEvent.click(
      within(row).getByRole("button", {
        name: "Make state 2 the entry state",
      }),
    );
    expect(
      (within(row).getByLabelText("State 1 name") as HTMLInputElement).value,
    ).toBe("build");
    // …and the state that is now second is unreachable from the new entry, which is
    // worth saying without refusing to save it.
    expect(
      within(row).getByText(/unreachable from `build`/),
    ).toBeInTheDocument();
  });

  it("refuses a state that runs another machine", () => {
    // A shell cannot be a state — it would recurse — so the picker offers it, labelled,
    // and the form refuses it rather than silently repointing the state somewhere else.
    const row = openMachine(machineDraft(LINEAR));
    const agent = within(row).getByLabelText("State 1 agent");
    expect(
      within(agent).getByRole("option", { name: "Feature (root, a machine)" }),
    ).toBeDefined();
    fireEvent.change(agent, {
      target: {
        value: (
          within(agent).getByRole("option", {
            name: "Feature (root, a machine)",
          }) as HTMLOptionElement
        ).value,
      },
    });
    expect(within(row).getByText(/itself a state machine/)).toBeInTheDocument();
  });
});

// Whether a module's state is carried in its holder's prompt is a per-agent, per-module
// decision, and it is written down: gg reads the arm the configuration names and has none
// of its own, so the picker opens on `owned` rather than on a blank row that would have to
// mean something.
//
// Asked of project management rather than memories: the board and the thread archive are
// the two capabilities that still offer the picker at all. Memories and skills dropped it
// with gg, so a test that kept looking for it there would be asserting a control that
// writes a key nothing reads.
describe("module ownership", () => {
  it("is offered on a module-backed capability and opens on owned", () => {
    renderCaps(draftWith("project-management", ""));
    const row = capabilityRow("project-management");
    const ownership = within(row).getByLabelText(
      /Ownership/,
    ) as HTMLSelectElement;
    expect(ownership.value).toBe("owned");
    expect(
      within(ownership).getByRole("option", { name: /Unowned/ }),
    ).toBeDefined();
  });

  it("is not offered on the two capabilities that no longer have one", () => {
    for (const capId of ["memories", "skills"]) {
      const { unmount } = renderCaps(draftWith(capId, ""));
      expect(
        within(capabilityRow(capId)).queryByLabelText(/^Ownership/),
      ).toBeNull();
      unmount();
    }
  });
});

// The `builtIns` toggles, rendered: eleven checkboxes that start on, because an absent
// param means gg offers every built-in skill it has one for. Only what an operator
// switches OFF is recorded, so the arm a study varies is a box being cleared — which is
// only visible by rendering the control and clicking it.
describe("the skills capability's built-in skills", () => {
  it("starts every built-in on and clears exactly the one switched off", () => {
    renderCaps(draftWith("skills", ""));
    const group = within(capabilityRow("skills")).getByRole("group", {
      name: "Built-in skills",
    });
    const boxes = within(group).getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(BUILT_IN_SKILL_OPTIONS.length);
    expect(boxes.every((box) => box.checked)).toBe(true);

    // Withhold the shell family's manual, and nothing else.
    const shell =
      boxes[
        BUILT_IN_SKILL_OPTIONS.findIndex(
          (option) => option.value === "gg-shell",
        )
      ]!;
    fireEvent.click(shell);
    expect(shell.checked).toBe(false);
    expect(boxes.filter((box) => !box.checked)).toEqual([shell]);
  });
});

// Response healing's strategies are a `toggles` control whose members each sit at their
// own default arm — two on, `drop-doubled-response` off. A subtractive control could not
// express arming the last one at all, so what the checkbox does is only visible by
// rendering it and clicking.
describe("the responses-as-code agent's healing strategies", () => {
  function healingBoxes(): HTMLInputElement[] {
    const group = screen.getByRole("group", { name: "Response healing" });
    return within(group).getAllByRole("checkbox") as HTMLInputElement[];
  }

  it("opens a fresh capability with the one seeded-off repair off and every other one on", () => {
    renderCaps(draftWith("responses-as-code", "", {}, "rac"));
    const boxes = healingBoxes();
    const doubled = boxes.find((box) =>
      box.parentElement?.textContent?.includes("drop-doubled-response"),
    )!;
    expect(doubled.checked).toBe(false);
    expect(boxes.filter((box) => !box.checked)).toEqual([doubled]);
  });

  it("arms the seeded-off repair without moving any of the others", () => {
    renderCaps(draftWith("responses-as-code", "", {}, "rac"));
    const doubled = healingBoxes().find((box) =>
      box.parentElement?.textContent?.includes("drop-doubled-response"),
    )!;
    // Why this one starts the opposite way to every other member is on hover, where
    // every member's reason lives; the checkbox itself is the readout of which way it sits.
    expect(doubled.parentElement).toHaveAttribute(
      "title",
      expect.stringContaining("starts switched off"),
    );
    fireEvent.click(doubled);
    expect(doubled.checked).toBe(true);
    // And nothing else moved with it.
    expect(healingBoxes().every((box) => box.checked)).toBe(true);
  });
});

// A capability's feature sliders can, between them, name every call it offers — so an
// operator can switch a capability on and then switch all of it back off, and be left
// with a card that reads as configured and an agent that can call none of it. Nothing
// downstream reports that: the run record shows a model that never called the thing,
// which is what a model choosing not to use it looks like too. The form is the only place
// it can be said, and only driving the sliders shows that it is.
describe("a capability switched on whose calls are all switched off", () => {
  const WARNING = /disabled — this capability is on/;

  // The capability's own switch: the first checkbox in its row, in the header label above
  // everything its body holds.
  function capSwitch(capId: string): HTMLInputElement {
    return within(capabilityRow(capId)).getAllByRole(
      "checkbox",
    )[0] as HTMLInputElement;
  }

  // The per-feature sliders inside one capability's Features group.
  function featureSliders(capId: string, group: string): HTMLInputElement[] {
    return within(
      within(capabilityRow(capId)).getByRole("group", { name: group }),
    ).getAllByRole("checkbox") as HTMLInputElement[];
  }

  // Take back every one of a capability's features, one slider at a time — re-querying
  // between clicks, because each one re-renders the form the next click drives.
  function switchOffEveryFeature(capId: string, group: string) {
    for (let i = 0; i < featureSliders(capId, group).length; i += 1) {
      const slider = featureSliders(capId, group)[i]!;
      if (slider.checked) fireEvent.click(slider);
    }
  }

  // The draft the type-driven half of this starts from: the same agent, answering as code.
  function codeDraft(): GgConfigDraft {
    const draft = emptyDraft();
    return { ...draft, agents: [{ ...draft.agents[0]!, mode: "rac" }] };
  }

  it("says nothing until the last of a tool agent's tools from it is gone", () => {
    renderCaps(emptyDraft());
    // Switching the capability on grants everything it offers, which is the state the
    // warning must stay quiet about.
    fireEvent.click(capSwitch("agent-managed-context"));
    const group = "Agent-managed context features";
    expect(
      featureSliders("agent-managed-context", group).every((s) => s.checked),
    ).toBe(true);
    expect(
      within(capabilityRow("agent-managed-context")).queryByText(WARNING),
    ).toBeNull();

    // One slider off is a narrowed capability, not an empty one.
    fireEvent.click(featureSliders("agent-managed-context", group)[0]!);
    expect(
      within(capabilityRow("agent-managed-context")).queryByText(WARNING),
    ).toBeNull();

    switchOffEveryFeature("agent-managed-context", group);
    expect(
      within(capabilityRow("agent-managed-context")).getByText(
        /All tools disabled/,
      ),
    ).toBeInTheDocument();
  });

  it("does not block the save it warns about", () => {
    renderCaps(emptyDraft());
    fireEvent.click(capSwitch("agent-managed-context"));
    switchOffEveryFeature(
      "agent-managed-context",
      "Agent-managed context features",
    );
    expect(screen.getByText(/All tools disabled/)).toBeInTheDocument();
    // The tab badge counts what would refuse the save, and this is not one of those: an
    // agent holding a capability it can never call launches, it just never calls it.
    expect(screen.queryByLabelText(/problem/)).toBeNull();
  });

  it("goes with the capability when that is switched off", () => {
    renderCaps(emptyDraft());
    fireEvent.click(capSwitch("agent-managed-context"));
    switchOffEveryFeature(
      "agent-managed-context",
      "Agent-managed context features",
    );
    fireEvent.click(capSwitch("agent-managed-context"));
    expect(screen.queryByText(WARNING)).toBeNull();
  });

  it("names the operations a code agent reads, not the tools it never will", () => {
    renderCaps(codeDraft());
    fireEvent.click(capSwitch("agent-managed-context"));
    switchOffEveryFeature(
      "agent-managed-context",
      "Agent-managed context features",
    );
    expect(
      within(capabilityRow("agent-managed-context")).getByText(
        /All operations disabled/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/All tools disabled/)).toBeNull();
  });

  it("is absent from a capability that hands the agent no call at all", () => {
    // A pure setting — it changes the window gg gives the model and offers nothing to
    // call — so an empty allowlist contribution is what it is meant to make.
    renderCaps(emptyDraft());
    fireEvent.click(capSwitch("context-window-override"));
    expect(
      within(capabilityRow("context-window-override")).getByLabelText(
        /Window limit/,
      ),
    ).toBeDefined();
    expect(screen.queryByText(WARNING)).toBeNull();
  });
});

// Loop detection is a per-agent, non-capability lever: it changes nothing about what the
// agent can do, only how gg talks to its model. It is authored like a capability all the
// same — a switch, a purpose, and a body of knobs revealed once it is on — and only
// rendering it shows that the knobs appear when armed and survive being disarmed.
describe("an agent's loop detection", () => {
  function loopSwitch(): HTMLInputElement {
    return within(
      screen.getByText("Loop detection").closest("label")!,
    ).getByRole("checkbox") as HTMLInputElement;
  }

  it("opens disarmed, with no knobs to tune on a detector that is not running", () => {
    render(<Harness initial={emptyDraft()} />);
    expect(loopSwitch().checked).toBe(false);
    expect(screen.queryByLabelText(/^Window \(words\)/)).toBeNull();
  });

  it("reveals its knobs when armed, each of them filled in", () => {
    render(<Harness initial={emptyDraft()} />);
    fireEvent.click(loopSwitch());
    const window = screen.getByLabelText(
      /Window \(words\)/,
    ) as HTMLInputElement;
    // Filled in by the act of arming it: the rule trips on the five knobs together and gg
    // lends no figure for a missing one, so the operator is looking at the detector that
    // would actually run, with every number in reach.
    expect(window.value).toBe("256");
    expect(
      (screen.getByLabelText(/^Reply ceiling/) as HTMLInputElement).value,
    ).toBe("250000");
    for (const spec of LOOP_DETECTION_SPECS) {
      const field = screen.getByLabelText(
        new RegExp(spec.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      ) as HTMLInputElement;
      expect(field.value).toBe(String(spec.authored));
    }
    // The bare figure, still, for a field an operator has cleared.
    expect(window.placeholder).toBe("256");
  });

  it("keeps a tuned knob when the detector is switched back off", () => {
    render(<Harness initial={emptyDraft()} />);
    fireEvent.click(loopSwitch());
    fireEvent.change(screen.getByLabelText(/^Window \(words\)/), {
      target: { value: "512" },
    });
    fireEvent.click(loopSwitch());
    expect(loopSwitch().checked).toBe(false);
    fireEvent.click(loopSwitch());
    expect(
      (screen.getByLabelText(/^Window \(words\)/) as HTMLInputElement).value,
    ).toBe("512");
  });

  it("says so on the form when the knobs describe a detector that could never trip", () => {
    render(<Harness initial={emptyDraft()} />);
    fireEvent.click(loopSwitch());
    fireEvent.change(screen.getByLabelText(/^Window \(words\)/), {
      target: { value: "8" },
    });
    fireEvent.change(screen.getByLabelText(/^Offenders to saturate/), {
      target: { value: "20" },
    });
    expect(screen.getByText(/could never trip/)).toBeInTheDocument();
  });

  it("is absent under a machine, which takes no turns and so has no reply to watch", () => {
    const draft = emptyDraft();
    render(
      <Harness
        initial={{
          ...draft,
          agents: [{ ...draft.agents[0]!, mode: "fsm" }],
        }}
      />,
    );
    expect(screen.queryByText("Loop detection")).toBeNull();
  });
});

// The `replay` capability is gone: it escalated a run's capture to a fidelity only a
// reconstruction needed, and there is no reconstruction. Every run captures the same
// session record, so there is nothing left to author — and nothing left to leave behind
// on the Agent tab or in an otherwise-empty capability group.
describe("the withdrawn replay capability", () => {
  it("is offered nowhere, and took its empty group with it", () => {
    render(<Harness initial={emptyDraft()} />);
    expect(screen.queryByText(/replay/i)).toBeNull();
    renderCaps(emptyDraft());
    expect(screen.queryByText(/replay/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Debugging/i })).toBeNull();
  });
});

// Where a hook is authored follows from its event, and the editor is what enforces it: an
// agent is offered only the eight events that fire because of something it did, and the
// configuration only the run's own two. An operator who can pick a session event on an
// agent has authored a configuration gg refuses at launch, so the pickers are the gate.
describe("the two hook lists", () => {
  // The events one hook row's Event picker offers.
  function eventOptions(): string[] {
    return Array.from(
      screen.getByLabelText(/^Event/).querySelectorAll("option"),
    ).map((option) => (option as HTMLOptionElement).value);
  }

  it("offers an agent its own eight events and none of the run's", () => {
    render(<Harness initial={emptyDraft()} />);
    openTab("Hooks");
    fireEvent.click(screen.getByRole("button", { name: "Add hook" }));

    const events = eventOptions();
    expect(events).toEqual([
      "pre-write",
      "post-write",
      "pre-shell",
      "post-shell",
      "pre-compact",
      "post-compact",
      "agent-start",
      "agent-stop",
    ]);
    // A new hook opens on one of them, so it is never born in the wrong list.
    expect(events).toContain("agent-stop");
  });

  it("offers the configuration only the run's two session events", () => {
    render(<ConfigHarness initial={emptyDraft()} />);
    // The session hooks sit on the Configuration tab, beside the run's ceilings.
    fireEvent.click(screen.getByRole("button", { name: "Add hook" }));
    expect(eventOptions()).toEqual(["session-start", "session-end"]);
  });

  it("has no Hooks section under a machine, which provokes none of the events", () => {
    render(<Harness initial={emptyDraft()} />);
    fireEvent.click(typeSegment("FSM"));
    expect(
      screen
        .getAllByRole("tab")
        .map((tab) => tab.firstElementChild?.textContent?.trim()),
    ).not.toContain("Hooks");
  });

  // A hook is a record of several fields and a list of them is several records, so each
  // one is a card with its own remove control — named, because "Remove" repeated down a
  // list says nothing about which hook it removes.
  it("gives each hook its own card, with a remove control that names it", () => {
    render(<Harness initial={emptyDraft()} />);
    openTab("Hooks");
    fireEvent.click(screen.getByRole("button", { name: "Add hook" }));

    // A fresh hook has no name of its own, so the control falls back to its event.
    const remove = screen.getByRole("button", { name: /^Remove the .* hook$/ });
    fireEvent.change(screen.getByLabelText(/^Name/), {
      target: { value: "build must pass" },
    });
    expect(
      screen.getByRole("button", { name: "Remove the build must pass hook" }),
    ).toBe(remove);

    fireEvent.click(remove);
    expect(screen.queryByLabelText(/^Event/)).toBeNull();
  });
});

// The form's tabs are named by the tab strip, and its controls by their own labels. Copy
// that repeats either — a heading saying "Tools" on the Tools tab, a paragraph explaining
// that the Tools tab lists tools — pushes the first control further down the page and is
// read once and never again.
describe("the sections that no longer explain themselves", () => {
  it("heads neither capability tab, under either agent type", () => {
    renderCaps(emptyDraft());
    expect(
      screen.queryByText(/What this agent is offered as tools/),
    ).toBeNull();

    const draft = emptyDraft();
    renderCaps({
      ...draft,
      agents: [{ ...draft.agents[0]!, mode: "rac" }],
    });
    expect(
      screen.queryByText(/What this agent's programs can call/),
    ).toBeNull();
    // The sandbox settings keep the accessible name their panel is found by; what goes
    // is the heading and the blurb above it.
    expect(screen.queryByText(/whole reply is a program/)).toBeNull();
    expect(
      screen.getAllByRole("group", { name: "Responses as code" }).length,
    ).toBe(1);
  });

  it("says only that an agent has no hooks, and not what having none means", () => {
    render(<Harness initial={emptyDraft()} />);
    openTab("Hooks");
    expect(screen.getByText("No hooks.")).toBeInTheDocument();
    expect(screen.queryByText(/These fire for/)).toBeNull();
    expect(screen.queryByText(/control arm/)).toBeNull();
  });
});

// Importing a saved agent, which is the second way to declare a profile.
//
// The overlay's arithmetic is tested in `ggAgentLibrary.test.ts`; what only rendering
// the form shows is that an operator can see which profiles follow a saved agent, what
// each has pinned, and how to stop following one — none of which is derivable from the
// draft alone.
describe("importing a saved agent", () => {
  // A saved agent as the library returns it: one whole profile, declaring the passthrough
  // `critic` slot its own binding defers to. A saved agent is one profile and nothing
  // else — the slots ride on it, so an import brings them along without the configuration
  // having to declare anything.
  function savedReviewer(name = "reviewer"): GgSavedAgent {
    const slot = { ...blankModelSlot("critic", true) };
    const blank = {
      ...blankAgentDraft(name),
      modelSlots: [slot],
      modelSlotId: slot.id,
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
      id: "saved-1",
      name,
      description: "reviews what the implementer wrote",
      agent: set.agents![0]!,
      updatedAt: "2026-08-18T00:00:00Z",
    };
  }

  // The editor with its open view under the test's control, so importing (which opens
  // the imported profile) and returning to the configuration are both reachable.
  function LibraryHarness({
    initial,
    saved = savedReviewer(),
  }: {
    initial: GgConfigDraft;
    saved?: GgSavedAgent;
  }) {
    const [draft, setDraft] = useState(initial);
    const [open, setOpen] = useState<string | null>(null);
    return (
      <>
        {/* The page owns the control that returns from an agent to the configuration,
            so the harness stands in for it. */}
        <button type="button" onClick={() => setOpen(null)}>
          close agent
        </button>
        <GgConfigEditor
          value={draft}
          onChange={setDraft}
          name="under test"
          onNameChange={() => {}}
          description=""
          onDescriptionChange={() => {}}
          editingAgentId={open}
          onEditingAgentChange={setOpen}
          models={[]}
          savedAgents={[saved]}
        />
      </>
    );
  }

  function closeAgent() {
    fireEvent.click(screen.getByRole("button", { name: "close agent" }));
  }

  function importReviewer(saved?: GgSavedAgent) {
    render(<LibraryHarness initial={emptyDraft()} saved={saved} />);
    openTab("Agents");
    fireEvent.click(screen.getByRole("button", { name: "+ Import agent" }));
    // The picker lists one row per library entry, named by the entry — clicking it is
    // the whole import.
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: new RegExp(`^${saved?.name ?? "reviewer"}`),
      }),
    );
  }

  // The library is picked from a list, not a `<select>`: an entry's own note is what tells
  // two entries carrying one name apart, and an `<option>` cannot carry one.
  it("lists each library entry over its own note, and imports the row that is clicked", () => {
    render(<LibraryHarness initial={emptyDraft()} />);
    openTab("Agents");
    fireEvent.click(screen.getByRole("button", { name: "+ Import agent" }));
    const row = within(screen.getByRole("dialog")).getByRole("button", {
      name: /^reviewer/,
    });
    expect(row).toHaveTextContent("reviews what the implementer wrote");

    fireEvent.click(row);
    // The dialog closes onto the profile it added, which is the thing an import was for.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText(/Follows the saved agent/)).toBeVisible();
  });

  it("leaves the configuration alone when the picker is dismissed", () => {
    render(<LibraryHarness initial={emptyDraft()} />);
    openTab("Agents");
    fireEvent.click(screen.getByRole("button", { name: "+ Import agent" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(/Follows the saved agent/)).toBeNull();
  });

  it("offers no import control when the account has saved no agents", () => {
    render(<ConfigHarness initial={emptyDraft()} />);
    openTab("Agents");
    expect(screen.queryByRole("button", { name: "+ Import agent" })).toBeNull();
    expect(screen.getByRole("button", { name: "+ Add agent" })).toBeVisible();
  });

  it("opens the imported profile, saying what it follows and that it pins nothing", () => {
    importReviewer();
    expect(screen.getByText(/Follows the saved agent/)).toBeVisible();
    expect(screen.getByText("Nothing pinned here yet.")).toBeVisible();
    // Reverting is offered only once there is something to revert.
    expect(
      screen.getByRole("button", { name: "Revert to the saved agent" }),
    ).toBeDisabled();
  });

  it("names the field an edit pins, and offers to revert it", () => {
    importReviewer();
    fireEvent.change(
      screen.getByPlaceholderText(/^Extra instructions for this agent/),
      { target: { value: "Be brief." } },
    );
    expect(
      screen.getByText(/Pinned here: Custom instructions\./),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Revert to the saved agent" }),
    ).toBeEnabled();
  });

  it("marks the profile as following the saved agent on the configuration's list", () => {
    // The row has to say what the open view says, or a configuration's provenance is
    // only visible one profile at a time.
    importReviewer();
    closeAgent();
    openTab("Agents");
    expect(screen.getByText("follows reviewer")).toBeVisible();
  });

  it("stops following the saved agent once the profile is detached", () => {
    importReviewer();
    fireEvent.click(screen.getByRole("button", { name: "Detach" }));
    expect(screen.queryByText(/Follows the saved agent/)).toBeNull();
    closeAgent();
    openTab("Agents");
    expect(screen.queryByText("follows reviewer")).toBeNull();
  });

  // The slot an imported profile defers to arrives **on** the profile, so the import is
  // whole on its own: the configuration declares nothing, and the launch asks for the
  // slot under the name the profile lends it. The Slots tab an operator finds it on is
  // therefore the agent's, not the configuration's.
  it("brings the model slot the imported profile defers to along with it", () => {
    importReviewer();
    openTab("Slots");
    expect(screen.getByLabelText("Slot name")).toHaveValue("critic");
    expect(
      screen.getByRole("checkbox", { name: /^Passthrough/ }),
    ).toBeChecked();

    // …and the configuration itself declares no launch input of its own, because it did
    // not have to: a passthrough slot reaches the launch form unaided.
    closeAgent();
    openTab("Slots");
    expect(screen.getByText(/No configuration slots/)).toBeVisible();
    expect(screen.getByText("reviewer.critic")).toBeVisible();
  });

  // A slug is unique within a configuration, and an import arrives under the saved
  // agent's own — nothing is uniquified, because a silently renamed import is a profile
  // the operator's other configurations, and the model's own roster, no longer agree on.
  // So a collision is *shown*, on both of the rows it is about.
  it("flags both rows when an import lands on a slug a profile already carries", () => {
    // The library's profile answers to `root`, which is the slug the configuration's own
    // first profile was minted with.
    importReviewer(savedReviewer("Root"));
    closeAgent();
    openTab("Agents");
    const complaints = screen.getAllByText(/Another profile carries the slug/);
    expect(complaints).toHaveLength(2);
    expect(complaints[0]).toHaveTextContent(
      "rename one of them, or override the imported profile’s slug",
    );
    // The tab strip says how many rows to look at, so the fault is findable from any tab.
    expect(
      screen
        .getAllByRole("tab")
        .find((tab) => tab.firstElementChild?.textContent?.trim() === "Agents")!
        .textContent,
    ).toContain("2");
  });

  // …and the way out of it. Both remedies the complaint offers act on a *row*: renaming
  // one of the two, and removing one of the two. Neither could be addressed by slug —
  // that is the one thing the pair does not tell apart — so this is the test that says the
  // collision is a state an operator can get out of rather than one that bricks the
  // configuration.
  it("makes the configuration savable again when the imported row is renamed", () => {
    importReviewer(savedReviewer("Root"));
    // The import opened the profile it appended: the *second* `root`, which is the row a
    // slug could not have named.
    expect(screen.getByText(/Follows the saved agent/)).toBeVisible();
    fireEvent.change(screen.getByLabelText(/^Slug/), {
      target: { value: "reviewer" },
    });
    // A slug the configuration wrote is a field it pins, like any other: the profile still
    // follows the saved agent in everything else, under a slug of its own.
    expect(screen.getByText(/^Pinned here: Slug\b/)).toBeVisible();

    closeAgent();
    openTab("Agents");
    expect(screen.queryByText(/Another profile carries the slug/)).toBeNull();
    expect(
      screen
        .getAllByRole("tab")
        .find((tab) => tab.firstElementChild?.textContent?.trim() === "Agents")!
        .textContent,
    ).toBe("Agents");
  });

  it("removes only the imported row when it is the row removed", () => {
    importReviewer(savedReviewer("Root"));
    closeAgent();
    openTab("Agents");
    // The import is named apart from the profile it landed beside — names are prose, so
    // they are uniquified where the slugs deliberately are not.
    fireEvent.click(
      screen.getByRole("button", { name: "Remove the Root-2 agent" }),
    );

    // One row left, and it is the configuration's own: a removal keyed by slug would have
    // taken both, leaving a configuration with no agents at all.
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
    expect(screen.queryByText("follows Root")).toBeNull();
    expect(screen.queryByText(/Another profile carries the slug/)).toBeNull();
  });

  it("opens the row Edit was pressed on, and edits that row alone", () => {
    importReviewer(savedReviewer("Root"));
    closeAgent();
    openTab("Agents");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[1]!);

    // The second row is the imported one; the first is declared inline and follows
    // nothing, so the note is proof of which of the two answered.
    expect(screen.getByText(/Follows the saved agent/)).toBeVisible();
    fireEvent.change(screen.getByLabelText(/^Agent name/), {
      target: { value: "Second opinion" },
    });

    closeAgent();
    openTab("Agents");
    // The profile beside it is untouched: an edit keyed by slug would have landed on both.
    // Read off the remove controls, which name each row, because the list also carries the
    // library's own `Root` in the import picker.
    expect(
      screen
        .getAllByRole("button", { name: /^Remove the / })
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Remove the Root agent", "Remove the Second opinion agent"]);
  });
});

// A profile's **slug** is the name the *model* is shown — in a roster, in a dispatch, in a
// transition — and it is the operator's to write. Nothing inside the configuration points
// at it: a roster entry, an `agent` param, a machine's state and the root flag all name the
// profile's internal id, which is minted once and never rewritten. That is what makes
// renaming an ordinary edit rather than a repointing exercise, and it is what leaves the
// *second* of two profiles that happen to carry one slug still separately openable and
// separately editable. Nothing but rendering the form and typing shows either.
describe("renaming an agent's slug", () => {
  // A configuration of two profiles carrying the two references one profile can make to
  // another: the root has the other on its roster (with the description an operator would
  // have to retype if the entry were dropped), and its board names the same profile as the
  // agent dispatched to resolve a conflicted merge.
  function referringDraft(): GgConfigDraft {
    const base = emptyDraft();
    const root = base.agents[0]!;
    const helper = blankAgentDraft("Helper", [], {}, base.agents);
    const board = root.capabilities["project-management"]!;
    return {
      ...base,
      agents: [
        {
          ...root,
          subagents: [
            {
              agentId: helper.id,
              description: "for the tricky bits",
              scopes: ["subagent"],
            },
          ],
          capabilities: {
            ...root.capabilities,
            "project-management": {
              ...board,
              enabled: true,
              params: { ...board.params, mergeAgentId: helper.id },
            },
          },
        },
        helper,
      ],
    };
  }

  // A configuration whose root is a machine over one worker. A state *binds* a profile,
  // which is the third kind of reference, and the one an operator would have to re-point
  // by hand if a rename orphaned it.
  function machineDraft(): GgConfigDraft {
    const base = emptyDraft();
    const worker = blankAgentDraft("Explorer", [], {}, base.agents);
    const shell = base.agents[0]!;
    return {
      ...base,
      agents: [
        {
          ...shell,
          name: "Feature",
          mode: "fsm" as const,
          capabilities: {
            ...shell.capabilities,
            fsm: {
              enabled: true,
              params: {
                states: statesDraftValue([
                  { name: "explore", agentId: worker.id, transitions: [] },
                ]),
              },
              extraParams: {},
            },
          },
        },
        worker,
      ],
    };
  }

  // The editor with its open view under the test's control, so a rename (which happens on
  // an agent) and its consequences (which are on the configuration) are both reachable.
  // Opened on a profile's **internal id**, which is what the page holds too — an index
  // would move under a removal, and a slug names two rows exactly when it matters most.
  function OpenHarness({
    initial,
    open,
  }: {
    initial: GgConfigDraft;
    open: string;
  }) {
    const [draft, setDraft] = useState(initial);
    const [editing, setEditing] = useState<string | null>(open);
    return (
      <>
        {/* The page owns the control that returns from an agent to the configuration,
            so the harness stands in for it. */}
        <button type="button" onClick={() => setEditing(null)}>
          close agent
        </button>
        <GgConfigEditor
          value={draft}
          onChange={setDraft}
          name="under test"
          onNameChange={() => {}}
          description=""
          onDescriptionChange={() => {}}
          editingAgentId={editing}
          onEditingAgentChange={setEditing}
          models={[]}
        />
      </>
    );
  }

  function closeAgent() {
    fireEvent.click(screen.getByRole("button", { name: "close agent" }));
  }

  // Return to the configuration and open the profile in row `index` — the way an operator
  // reaches the *other* profile, and the only way the effect of a rename on what points at
  // the renamed one can be looked at.
  function reopen(index: number) {
    closeAgent();
    openTab("Agents");
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[index]!);
  }

  function renameSlug(slug: string) {
    fireEvent.change(screen.getByLabelText(/^Slug/), {
      target: { value: slug },
    });
  }

  it("leaves the roster entry that named the profile granted, under the new slug", () => {
    const draft = referringDraft();
    render(<OpenHarness initial={draft} open={draft.agents[1]!.id} />);
    renameSlug("critic");
    // The view stayed on the profile it was opened on: which profile is open is that
    // profile's id, so there is no instant at which it stops answering to it.
    expect(screen.getByLabelText(/^Slug/)).toHaveValue("critic");
    expect(screen.getByLabelText(/^Agent name/)).toHaveValue("Helper");

    reopen(0);
    openTab("Roster");
    // Still granted and still carrying its description — the entry named the profile's
    // id, so the rename had nothing to fix up — and the row now offers the model the new
    // slug, which is the one thing about it that did move.
    expect(screen.getByDisplayValue("for the tricky bits")).toBeVisible();
    expect(screen.getByText("critic")).toBeVisible();
    expect(screen.queryByText("helper")).toBeNull();
  });

  it("leaves an `agent` param naming the profile pointed at it, relabelled", () => {
    const draft = referringDraft();
    const helperId = draft.agents[1]!.id;
    render(<OpenHarness initial={draft} open={helperId} />);
    renameSlug("critic");

    reopen(0);
    openTab("Tools");
    const merge = within(capabilityRow("project-management")).getByLabelText(
      /Merge agent/,
    ) as HTMLSelectElement;
    // The param stores the id, so it is still pointed at the same profile rather than
    // having fallen back to the "(missing)" option a dropped reference would leave — and
    // the option it selects is spelled with the slug the operator has just written.
    expect(merge.value).toBe(helperId);
    expect(within(merge).queryByRole("option", { name: /missing/ })).toBeNull();
    expect(
      (
        within(merge).getByRole("option", {
          name: "Helper (critic)",
        }) as HTMLOptionElement
      ).value,
    ).toBe(helperId);
  });

  it("leaves a machine's state running the profile that state bound", () => {
    const draft = machineDraft();
    const workerId = draft.agents[1]!.id;
    render(<OpenHarness initial={draft} open={workerId} />);
    renameSlug("scout");

    reopen(0);
    openTab("States");
    const bound = screen.getByLabelText("State 1 agent") as HTMLSelectElement;
    expect(bound.value).toBe(workerId);
    // A state whose agent had been orphaned says so beside the row, so the machine being
    // silent here is the whole of "gg would still launch it".
    expect(screen.queryByText(/runs no agent/)).toBeNull();
    expect(
      within(bound).getByRole("option", { name: "Explorer (scout)" }),
    ).toBeDefined();
  });

  it("leaves the root flag on the profile it was already on", () => {
    const draft = referringDraft();
    render(<OpenHarness initial={draft} open={draft.agents[0]!.id} />);
    renameSlug("conductor");

    closeAgent();
    openTab("Agents");
    // The root is a flag naming a profile's id, so there is nothing here for the rename to
    // have carried — and the badge is still on the row whose slug moved.
    const badge = screen.getByText("root", { selector: "span" });
    expect(badge.parentElement?.parentElement).toHaveTextContent("conductor ·");
    // …and the role did not quietly spread: the other profile is still offered the
    // control that would take it.
    expect(screen.getAllByRole("button", { name: "Make root" })).toHaveLength(
      1,
    );
  });

  it("refuses a slug gg could not hold, and one another profile already answers to", () => {
    const draft = referringDraft();
    render(<OpenHarness initial={draft} open={draft.agents[1]!.id} />);

    // The shape gg holds a slug to — it is prose the *model* is shown and passes back.
    renameSlug("Merge Bot");
    expect(
      screen.getByText(/^A slug is lowercase letters and digits/),
    ).toBeVisible();

    renameSlug("critic");
    expect(screen.queryByText(/^A slug is lowercase/)).toBeNull();

    // …and the one thing about a slug that cannot be decided by looking at this profile
    // alone: whether another already answers to it, which would leave the model shown one
    // name for two profiles.
    renameSlug(draft.agents[0]!.slug);
    expect(
      screen.getByText(
        /^Another agent in this configuration carries this slug/,
      ),
    ).toBeVisible();
  });

  // Two profiles under one slug is a state the editor deliberately lets an operator reach —
  // an import arrives under the saved agent's own slug rather than a quietly uniquified one
  // — and it is the state the two-field identity exists for. While it lasts the slug names
  // both rows and so identifies neither, and everything the editor does keyed by profile
  // has to go on naming exactly one of them.
  it("opens the second of two profiles carrying one slug, and edits that one alone", () => {
    const base = emptyDraft();
    const twin = {
      ...blankAgentDraft("Twin", [], {}, base.agents),
      slug: base.agents[0]!.slug,
    };
    const draft = { ...base, agents: [...base.agents, twin] };
    render(<OpenHarness initial={draft} open={twin.id} />);

    // The row that answered is the second: its name is the half of the two rows they do
    // not share. And the collision is reported rather than resolved for the operator.
    expect(screen.getByLabelText(/^Agent name/)).toHaveValue("Twin");
    expect(
      screen.getByText(
        /^Another agent in this configuration carries this slug/,
      ),
    ).toBeVisible();

    renameSlug("twin");
    fireEvent.change(screen.getByLabelText(/^Agent name/), {
      target: { value: "Second opinion" },
    });

    closeAgent();
    openTab("Agents");
    // Both edits landed on the second row alone. Read off the remove controls, which name
    // each row: an editor keyed by slug would have written both at once, which is exactly
    // what a collision would have made it do.
    expect(
      screen
        .getAllByRole("button", { name: /^Remove the / })
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Remove the Root agent", "Remove the Second opinion agent"]);
    expect(screen.queryByText(/Another profile carries the slug/)).toBeNull();
  });
});

// The Slots tab is where the two halves of the model mapping meet: the agents declare the
// slots their bindings defer to, and the configuration declares the **launch inputs** that
// fill them. Neither half says on its own what a run will actually be asked for, which is
// what the tab's summary is for — and an agent slot that reaches that set no way at all
// leaves a binding with nowhere to get a model from, which is what its errors are for.
describe("the configuration's launch inputs", () => {
  // Two profiles whose slots are *not* passthrough: the shape a configuration slot exists
  // for, since one launch input filling several agents' slots at once is the whole reason
  // to declare one.
  function unmappedDraft(): GgConfigDraft {
    const base = emptyDraft();
    const helper = blankAgentDraft("Helper", [], {}, base.agents);
    return {
      ...base,
      agents: [...base.agents, helper].map((agent) => ({
        ...agent,
        modelSlots: agent.modelSlots.map((slot) => ({
          ...slot,
          passthrough: false,
        })),
      })),
    };
  }

  // One line of the "Exposed at launch" summary, by the name the launch form asks under.
  function launchRow(name: string): HTMLElement {
    return screen.getByText(name, { selector: "code" }).closest("li")!;
  }

  it("asks for a passthrough slot under the name the agent that declares it lends it", () => {
    render(<ConfigHarness initial={emptyDraft()} />);
    openTab("Slots");
    // Nothing declared here, and a launch that still asks for a model: a passthrough slot
    // reaches the form unaided, which is what makes a configuration that says nothing
    // about models launchable.
    expect(screen.getByText(/No configuration slots/)).toBeVisible();
    expect(launchRow("root.primary")).toHaveTextContent(
      "→ Root (root) · primary",
    );
  });

  it("reports each agent slot that reaches no launch input, on the tab and on the strip", () => {
    render(<ConfigHarness initial={unmappedDraft()} />);
    openTab("Slots");
    expect(
      screen.getAllByText(/reaches no launch input, so its bindings would run/),
    ).toHaveLength(2);
    // A launch would ask for nothing at all, which is the other half of the same fault.
    expect(screen.getByText(/a launch asks for no model at all/)).toBeVisible();
    expect(
      screen
        .getAllByRole("tab")
        .find((tab) => tab.firstElementChild?.textContent?.trim() === "Slots")!
        .textContent,
    ).toContain("2");
  });

  it("fills two agents' slots from one launch input, and says so in the summary", () => {
    render(<ConfigHarness initial={unmappedDraft()} />);
    openTab("Slots");
    fireEvent.click(
      screen.getByRole("button", { name: "+ Add configuration slot" }),
    );
    // A launch input that fills nothing is a model collected and handed to nobody, so it
    // is a fault of its own until it names a target.
    expect(screen.getByText(/hand it to no agent/)).toBeVisible();

    fireEvent.change(screen.getByLabelText("Slot name"), {
      target: { value: "shared" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Root (root) · primary" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Helper (helper) · primary" }),
    );

    // One picker at launch, two agents run off it — and both complaints are answered.
    expect(launchRow("shared")).toHaveTextContent(
      "→ Root (root) · primary, Helper (helper) · primary",
    );
    expect(screen.queryByText(/reaches no launch input/)).toBeNull();
    expect(screen.queryByText(/hand it to no agent/)).toBeNull();
  });

  it("clears a fill with the checkbox that set it, and reports the slot again", () => {
    // A `Fills` box is the only control that maps or unmaps, and unmapping is not just a
    // narrower mapping: it puts a binding back to having no model to run at all, which the
    // tab has to start reporting again the instant the box is cleared. A checkbox that only
    // ever added would leave an operator deleting a launch input and declaring it afresh in
    // order to take one agent back off it.
    render(<ConfigHarness initial={unmappedDraft()} />);
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
      screen.getByRole("checkbox", { name: "Helper (helper) · primary" }),
    );
    expect(launchRow("shared")).toHaveTextContent(
      "→ Root (root) · primary, Helper (helper) · primary",
    );

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Helper (helper) · primary" }),
    );
    expect(
      screen.getByRole("checkbox", { name: "Helper (helper) · primary" }),
    ).not.toBeChecked();
    expect(launchRow("shared")).toHaveTextContent("→ Root (root) · primary");
    // …and the binding it had been filling is back to having nowhere to get a model from,
    // which is the state an operator has to be told about rather than left to launch into.
    expect(
      screen.getAllByText(/reaches no launch input, so its bindings would run/),
    ).toHaveLength(1);
  });

  it("asks for a passthrough slot under the profile's slug, and offers it under its name", () => {
    // The tab reads a profile two ways on purpose, and only a configuration where the two
    // differ can tell them apart. The checkbox list is prose an operator scans, so it names
    // a profile the way they wrote it; the summary is what the new-run form will actually
    // ask under, so it names it the way the *model* and the launch form do — `<slug>.<slot>`,
    // built off the same field [launchModelSlots] builds it off. A summary spelled from the
    // display name would promise an input no run asks for.
    const base = emptyDraft();
    const helper = blankAgentDraft("Helper", [], {}, base.agents);
    const draft: GgConfigDraft = {
      ...base,
      agents: [
        { ...base.agents[0]!, name: "The conductor", slug: "maestro" },
        {
          ...helper,
          modelSlots: helper.modelSlots.map((slot) => ({
            ...slot,
            passthrough: false,
          })),
        },
      ],
    };
    render(<ConfigHarness initial={draft} />);
    openTab("Slots");
    expect(launchRow("maestro.primary")).toHaveTextContent(
      "→ The conductor (maestro) · primary",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "+ Add configuration slot" }),
    );
    fireEvent.change(screen.getByLabelText("Slot name"), {
      target: { value: "shared" },
    });
    // The one candidate is the profile that is not exposed on its own, and it is offered
    // by name — the row is about which binding this input feeds, not about what the launch
    // form will call the input.
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Helper (helper) · primary" }),
    );
    expect(launchRow("shared")).toHaveTextContent(
      "→ Helper (helper) · primary",
    );
  });

  it("offers a slot already filled by another input as taken rather than hiding it", () => {
    render(<ConfigHarness initial={unmappedDraft()} />);
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
      screen.getByRole("button", { name: "+ Add configuration slot" }),
    );
    const names = screen.getAllByLabelText("Slot name");
    fireEvent.change(names[1]!, { target: { value: "second" } });
    // Shown, disabled and explained: "why is it missing?" is the question hiding it
    // would leave, and exactly one launch input supplies each binding.
    const taken = screen.getByRole("checkbox", {
      name: /Root \(root\) · primary filled by shared/,
    });
    expect(taken).toBeDisabled();
    expect(taken).not.toBeChecked();
  });
});

// Every control in a capability's grid opens on the figure it would run under, so a form
// full of real values cannot itself say which of them the operator has changed. That is
// what the reset beside a label is for, and why it is the *only* thing that says it — the
// labels used to carry clauses like "(starts off)", which restate a control's opening
// state beside a control that has since moved off it.
describe("a control that has been moved off its authored value", () => {
  // The reset lives inside the field's label row, so it is found through the row rather
  // than by scanning the whole form — two capabilities can offer a param of one name.
  function resetIn(row: HTMLElement, label: string): HTMLElement | null {
    return within(row).queryByRole("button", { name: `Reset ${label}` });
  }

  it("offers no reset while every control is still as it opened", () => {
    renderCaps(draftWith("shell", ""));
    const row = capabilityRow("shell");
    expect(resetIn(row, "Output mode")).toBeNull();
    expect(resetIn(row, "Max lines")).toBeNull();
  });

  it("offers one the moment a control moves, and puts the control back", () => {
    renderCaps(draftWith("shell", ""));
    const row = capabilityRow("shell");
    const lines = within(row).getByLabelText(/^Max lines/) as HTMLInputElement;
    const opened = lines.value;
    expect(opened).not.toBe("");

    fireEvent.change(lines, { target: { value: "7" } });
    const reset = resetIn(row, "Max lines");
    expect(reset).not.toBeNull();

    fireEvent.click(reset!);
    expect(
      (
        within(capabilityRow("shell")).getByLabelText(
          /^Max lines/,
        ) as HTMLInputElement
      ).value,
    ).toBe(opened);
    expect(resetIn(capabilityRow("shell"), "Max lines")).toBeNull();
  });

  it("resets the strategy picker to the arm a fresh capability selects", () => {
    renderCaps(draftWith("shell", ""));
    const row = capabilityRow("shell");
    const mode = within(row).getByLabelText(
      /^Output mode/,
    ) as HTMLSelectElement;
    const opened = mode.value;
    select(mode, "inline");
    expect(mode.value).toBe("inline");

    fireEvent.click(resetIn(capabilityRow("shell"), "Output mode")!);
    expect(
      (
        within(capabilityRow("shell")).getByLabelText(
          /^Output mode/,
        ) as HTMLSelectElement
      ).value,
    ).toBe(opened);
  });

  // A read-only form is a run's recorded configuration being read, not edited. Its inputs
  // are disabled; a reset that stayed live beside them would be the one control on the
  // page that could still change what is being read.
  it("offers none at all on a read-only form", () => {
    const draft = draftWith("shell", "", { maxLines: "7" });
    render(
      <GgConfigEditor
        value={draft}
        onChange={() => {}}
        name="under test"
        onNameChange={() => {}}
        description=""
        onDescriptionChange={() => {}}
        editingAgentId={draft.agents[0]!.id}
        onEditingAgentChange={() => {}}
        models={[]}
        readOnly
      />,
    );
    openTab("Tools");
    const row = capabilityRow("shell");
    expect(within(row).getByLabelText(/^Max lines/)).toBeDisabled();
    expect(resetIn(row, "Max lines")).toBeNull();
  });

  // Compaction's `maxRetries` is optional to gg — an absent key is none — and used to be
  // the one number in these grids left blank to say so, beside a sibling showing its own
  // figure. It opens on the `0` its absence already meant.
  it("opens compaction's optional retry count on the figure its absence meant", () => {
    renderCaps(draftWith("compaction", ""));
    const row = capabilityRow("compaction");
    expect(
      (within(row).getByLabelText(/^Max retries/) as HTMLInputElement).value,
    ).toBe("0");
    expect(resetIn(row, "Max retries")).toBeNull();
  });
});
