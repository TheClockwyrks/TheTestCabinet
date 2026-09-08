import { act, render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GgCapabilitySet } from "@clockwyrks/run-record/gg";
import type {
  ReviewPlanCase,
  ReviewPlanCombo,
} from "@clockwyrks/run-record/coverage";
import type { Model } from "../../../client/types";
import { defaultOpeningTurn, emptyDraft } from "../runs/gg/ggConfigDraft";
import type { GgConfigOption } from "../runs/gg/useGgConfigs";
import type { BackendClient } from "../../../client/clients";
import { BackendProvider } from "../../../client/context";
import {
  GalleryDataProvider,
  type GalleryDataInput,
} from "../../data/galleryContext";
import {
  AxisPicker,
  BufferTargetField,
  CasePicker,
  ComboPicker,
  axisLabel,
} from "./coveragePickers";
import exec from "../runs/RunExec.module.scss";

// The configurations the account has saved, whether they are still loading, and why
// the read failed — mutable so each test can put the picker in the state it is about
// (signed out, still loading, nothing saved, unreadable, one configuration with two
// launch slots).
let ggState: {
  options: GgConfigOption[];
  loading: boolean;
  error: string | null;
} = {
  options: [],
  loading: false,
  error: null,
};
// The signed-in account's token, or null. A gg configuration belongs to an account, so
// this is the difference between "you have none" and "we cannot know".
let authToken: string | null = "t";

vi.mock("../../../client/auth", () => ({
  useAuth: () => ({ token: authToken }),
}));
vi.mock("../runs/gg/useGgConfigs", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../runs/gg/useGgConfigs")>();
  return {
    ...actual,
    useGgConfigs: () => ({
      options: ggState.options,
      saved: [],
      loading: ggState.loading,
      error: ggState.error,
      reload: async () => {},
    }),
  };
});

// The ordering control names what a reviewer will be able to compare, never how the
// loop is nested — "depth first" / "breadth first" answer none of their question and
// must not reach the console. It is one setting with one answer, so it reads as a
// setting row whose control column shows that answer.
describe("AxisPicker", () => {
  function order(): HTMLSelectElement {
    return screen.getByLabelText("Run order") as HTMLSelectElement;
  }

  it("labels the axes the way the console names them everywhere", () => {
    expect(axisLabel("case")).toBe("One case at a time");
    expect(axisLabel("combination")).toBe("One model at a time");
  });

  it("shows the current axis as the row's value and offers the other", () => {
    render(<AxisPicker value="case" onChange={vi.fn()} />);
    expect(order().value).toBe("case");
    expect(Array.from(order().options).map((o) => o.textContent)).toEqual([
      "One case at a time",
      "One model at a time",
    ]);
  });

  it("reports the axis that was picked", () => {
    const onChange = vi.fn();
    render(<AxisPicker value="case" onChange={onChange} />);
    fireEvent.change(order(), { target: { value: "combination" } });
    expect(onChange).toHaveBeenCalledWith("combination");
  });

  it("describes what the selected order does, not the one beside it", () => {
    const { rerender } = render(<AxisPicker value="case" onChange={vi.fn()} />);
    expect(screen.getByText(/before the next case starts/i)).toBeTruthy();
    rerender(<AxisPicker value="combination" onChange={vi.fn()} />);
    expect(screen.getByText(/climbs the whole case list/i)).toBeTruthy();
  });

  // Which order a plan starts in is not written on the row, so the reset control is
  // the only thing that says the plan is no longer as it came.
  it("offers a reset only once the order has moved off the default", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <AxisPicker value="case" onChange={onChange} />,
    );
    expect(
      screen.queryByRole("button", { name: "Reset Run order" }),
    ).toBeNull();
    rerender(<AxisPicker value="combination" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Reset Run order" }));
    expect(onChange).toHaveBeenCalledWith("case");
  });

  it("can be locked without losing the value it is showing", () => {
    render(<AxisPicker value="combination" onChange={vi.fn()} disabled />);
    expect(order().disabled).toBe(true);
    expect(order().value).toBe("combination");
  });

  it("never describes the choice as a traversal", () => {
    const { container } = render(
      <AxisPicker value="case" onChange={vi.fn()} />,
    );
    expect(container.textContent).not.toMatch(/depth|breadth/i);
  });
});

// Empty and `0` are different instructions — "use my account default" versus "never
// top this plan up" — so the field must never collapse one into the other.
describe("BufferTargetField", () => {
  function renderField(value: number | null, onChange = vi.fn()) {
    render(
      <BufferTargetField
        value={value}
        accountDefault={7}
        onChange={onChange}
      />,
    );
    return {
      onChange,
      input: screen.getByRole("spinbutton") as HTMLInputElement,
    };
  }

  it("shows the inherited account default as the placeholder when unset", () => {
    const { input } = renderField(null);
    expect(input.value).toBe("");
    expect(input.getAttribute("placeholder")).toBe("7");
    expect(screen.getByText(/inherits your account default of 7/)).toBeTruthy();
  });

  it("reports an emptied field as null, not as zero", () => {
    const { onChange, input } = renderField(3);
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("keeps zero as a real instruction rather than as 'unset'", () => {
    const { onChange, input } = renderField(3);
    fireEvent.change(input, { target: { value: "0" } });
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("spells out what zero means, since it looks like an empty field", () => {
    renderField(0);
    expect(screen.getByText(/stops this plan topping itself up/i)).toBeTruthy();
    expect(screen.getByText(/different from empty/i)).toBeTruthy();
  });

  it("offers dropping the override without deleting digits", () => {
    const { onChange } = renderField(4);
    fireEvent.click(
      screen.getByRole("button", { name: "Reset Review buffer" }),
    );
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

const OPUS = "anthropic/claude-opus-4.8";
const HAIKU = "anthropic/claude-haiku-4.5";
const SOL = "openai/gpt-5.6-sol";

/** The two catalog models the pickers below offer, both reachable over OpenRouter —
 *  which is the only family gg launches through. */
const MODELS = [
  {
    slug: "claude-opus-4-8",
    name: "Claude Opus 4.8",
    curated: true,
    aliases: [
      { slug: OPUS, harnessFamily: "openrouter" },
      { slug: "claude-opus-4-8", harnessFamily: "claude" },
    ],
  },
  {
    slug: "gpt-5-6-sol",
    name: "GPT-5.6 Sol",
    curated: true,
    aliases: [{ slug: SOL, harnessFamily: "openrouter" }],
  },
] as unknown as Model[];

/** A configuration that asks for two models: the root's, and a reviewer's that comes
 *  with a default. The first is what the add-row fans out over until it is pointed at
 *  another. */
function twoSlotSet(): GgCapabilitySet {
  const agent = (slug: string, name: string) => ({
    id: `a-${slug}`,
    slug,
    name,
    capabilities: [],
    modelId: "",
    modelSlot: "primary",
    modelSlots: [{ name: "primary" }],
    openingTurn: defaultOpeningTurn(),
  });
  return {
    preset: "Nightly",
    agents: [agent("root", "Root"), agent("reviewer", "Reviewer")],
    modelSlots: [
      { name: "primary", targets: [{ agent: "a-root", slot: "primary" }] },
      {
        name: "critic",
        defaultModelId: HAIKU,
        targets: [{ agent: "a-reviewer", slot: "primary" }],
      },
    ],
  };
}

function ggOption(id = "cfg-1", name = "Nightly"): GgConfigOption {
  return {
    key: `saved:${id}`,
    name,
    description: "the nightly arm",
    capabilitySet: twoSlotSet(),
    draft: emptyDraft(),
  };
}

function renderPicker(combos: ReviewPlanCombo[] = [], onChange = vi.fn()) {
  render(
    <MemoryRouter>
      <ComboPicker combos={combos} onChange={onChange} models={MODELS} />
    </MemoryRouter>,
  );
  return onChange;
}

/** Point the add-row at its gg half. */
function chooseGgMode() {
  fireEvent.change(screen.getByLabelText("Combination kind"), {
    target: { value: "gg" },
  });
}

/** Type an id into a slot's model picker (free text is a first-class choice there). */
function typeModel(slot: string, id: string) {
  fireEvent.change(screen.getByLabelText(slot), { target: { value: id } });
}

// A combination has two shapes, and the add-row has to build both. The gg half is the
// one that would otherwise be missing entirely: gg runs make up most of the queue and
// were not askable for on this surface at all.
describe("ComboPicker gg mode", () => {
  beforeEach(() => {
    authToken = "t";
    ggState = { options: [ggOption()], loading: false, error: null };
  });

  // The shape is a choice from a fixed set, and it sits directly under a list of member
  // pills — as two filled pills it read as one more member of that list.
  it("asks for the shape as one labelled field", () => {
    renderPicker();
    const kind = screen.getByLabelText("Combination kind") as HTMLSelectElement;
    expect(kind.tagName).toBe("SELECT");
    expect([...kind.options].map((o) => o.textContent)).toEqual([
      "Harness",
      "gg configuration",
    ]);
    expect(screen.queryByRole("radiogroup", { name: /kind/i })).toBeNull();
  });

  it("offers the account's configurations, one model picker per launch slot", () => {
    renderPicker();
    chooseGgMode();
    const select = screen.getByLabelText(
      "gg configuration",
    ) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Nightly"]);
    // Both launch inputs are asked for, and the one the configuration defaults is
    // pre-filled — a configuration that names its models opens ready to add.
    expect((screen.getByLabelText("primary") as HTMLInputElement).value).toBe(
      "",
    );
    expect((screen.getByLabelText("critic") as HTMLInputElement).value).toBe(
      HAIKU,
    );
  });

  // The gg add-row is a **column**, so a flex basis on a child resolves as a height.
  // `comboFieldWide`'s 14rem basis therefore painted a 224px-tall box with the label
  // and select at the top of it and a field-sized hole underneath — twice over on a
  // multi-slot configuration, which shows the Fan out field as well. Asserted on the
  // class because the class is the bug: jsdom does no layout, so the hole itself is
  // not observable, and the rule ("no row class in this stack") is what has to hold.
  it("sizes every field in the stack by width alone, never by a row's flex basis", () => {
    renderPicker();
    chooseGgMode();
    const stacked = [
      screen.getByLabelText("gg configuration"),
      screen.getByLabelText("Fan out across"),
      screen.getByLabelText("primary"),
      screen.getByLabelText("critic"),
    ];
    for (const control of stacked) {
      const field = control.closest(`.${exec.field}`)!;
      expect(field.className).toContain(exec.comboSlotField);
      expect(field.className).not.toContain(exec.comboField);
      expect(field.className).not.toContain(exec.comboFieldWide);
    }
  });

  it("adds one member per model the first slot names", () => {
    const onChange = renderPicker();
    chooseGgMode();
    // One model picked from the list, one typed by hand: both stage, because either
    // is a model the reviewer meant.
    fireEvent.focus(screen.getByLabelText("primary"));
    fireEvent.click(screen.getByRole("option", { name: /Claude Opus 4.8/ }));
    typeModel("primary", SOL);
    fireEvent.click(screen.getByRole("button", { name: "+ Model" }));
    typeModel("primary", HAIKU);

    // The button says how many members the press will file, since the count is the
    // whole point of staging several.
    fireEvent.click(screen.getByRole("button", { name: "+ Add 3" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0]).toEqual([
      {
        harness: "gg",
        model: "",
        ggConfigId: "saved:cfg-1",
        ggConfigName: "Nightly",
        ggSlotModels: { primary: OPUS, critic: HAIKU },
      },
      {
        harness: "gg",
        model: "",
        ggConfigId: "saved:cfg-1",
        ggConfigName: "Nightly",
        ggSlotModels: { primary: SOL, critic: HAIKU },
      },
      {
        harness: "gg",
        model: "",
        ggConfigId: "saved:cfg-1",
        ggConfigName: "Nightly",
        ggSlotModels: { primary: HAIKU, critic: HAIKU },
      },
    ]);
  });

  // The "+ Add 3" the press carries is the whole of what the hint said, and it says it
  // against the models actually staged rather than in the abstract.
  it("leaves the fan-out unnarrated, since the add button already counts it", () => {
    renderPicker();
    chooseGgMode();
    expect(screen.queryByText(/Pick as many models as you like/)).toBeNull();
    expect(screen.queryByText(/one combination is added per model/)).toBeNull();
  });

  it("carries the remaining slots' models onto every member it adds", () => {
    const onChange = renderPicker();
    chooseGgMode();
    typeModel("critic", SOL);
    typeModel("primary", OPUS);
    fireEvent.click(screen.getByRole("button", { name: "+ Model" }));
    typeModel("primary", HAIKU);
    fireEvent.click(screen.getByRole("button", { name: "+ Add 2" }));
    expect(
      onChange.mock.calls[0]![0].map(
        (c: ReviewPlanCombo) => c.ggSlotModels?.critic,
      ),
    ).toEqual([SOL, SOL]);
  });

  it("will not add until every other slot has a model", () => {
    renderPicker();
    chooseGgMode();
    typeModel("critic", "");
    typeModel("primary", OPUS);
    expect(
      (screen.getByRole("button", { name: "+ Add" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("files a member the list already holds only once", () => {
    const existing: ReviewPlanCombo = {
      harness: "gg",
      model: "",
      ggConfigId: "saved:cfg-1",
      ggSlotModels: { primary: OPUS, critic: HAIKU },
    };
    const onChange = renderPicker([existing]);
    chooseGgMode();
    typeModel("primary", OPUS);
    fireEvent.click(screen.getByRole("button", { name: "+ Model" }));
    typeModel("primary", SOL);
    fireEvent.click(screen.getByRole("button", { name: "+ Add 2" }));
    expect(onChange.mock.calls[0]![0]).toHaveLength(2);
    expect(onChange.mock.calls[0]![0][1].ggSlotModels).toEqual({
      primary: SOL,
      critic: HAIKU,
    });
  });

  it("says a configuration belongs to an account rather than offering an empty picker", () => {
    authToken = null;
    renderPicker();
    chooseGgMode();
    expect(screen.getByText(/Sign in to plan runs/)).toBeTruthy();
    expect(screen.queryByLabelText("gg configuration")).toBeNull();
  });

  it("says so when the account has saved none", () => {
    ggState = { options: [], loading: false, error: null };
    renderPicker();
    chooseGgMode();
    expect(screen.getByText(/no saved gg configurations/)).toBeTruthy();
    expect(screen.queryByLabelText("gg configuration")).toBeNull();
  });

  // A read that failed knows nothing about the account, so it must not report the
  // account as empty: an operator with twenty configurations would be told they have
  // none and sent off to author another.
  it("says a failed read failed rather than that the account is empty", () => {
    ggState = { options: [], loading: false, error: "Error: 503" };
    renderPicker();
    chooseGgMode();
    expect(screen.getByText(/could not be loaded/)).toBeTruthy();
    expect(screen.queryByText(/no saved gg configurations/)).toBeNull();
    // "Save one" is the answer to an empty account, and this is not known to be one.
    expect(screen.queryByRole("link", { name: "Save one" })).toBeNull();
  });

  // The slot a sweep varies is the operator's choice: the slots arrive in the
  // configuration's declaration order, which is not an order they picked or can see,
  // and a sweep over a reviewer's model is as ordinary as one over the root's.
  it("fans out across whichever slot it is pointed at", () => {
    const onChange = renderPicker();
    chooseGgMode();
    fireEvent.change(screen.getByLabelText("Fan out across"), {
      target: { value: "critic" },
    });
    typeModel("primary", OPUS);
    typeModel("critic", HAIKU);
    fireEvent.click(screen.getByRole("button", { name: "+ Model" }));
    typeModel("critic", SOL);
    fireEvent.click(screen.getByRole("button", { name: "+ Add 2" }));
    expect(onChange.mock.calls[0]![0]).toEqual([
      {
        harness: "gg",
        model: "",
        ggConfigId: "saved:cfg-1",
        ggConfigName: "Nightly",
        ggSlotModels: { primary: OPUS, critic: HAIKU },
      },
      {
        harness: "gg",
        model: "",
        ggConfigId: "saved:cfg-1",
        ggConfigName: "Nightly",
        ggSlotModels: { primary: OPUS, critic: SOL },
      },
    ]);
  });

  // Staging a model the press would silently drop is what makes "+ Add 3" add one and
  // report nothing, so the model is not offered in the first place.
  it("leaves out a model that would rebuild a member the list already holds", () => {
    renderPicker([
      {
        harness: "gg",
        model: "",
        ggConfigId: "saved:cfg-1",
        ggConfigName: "Nightly",
        ggSlotModels: { primary: OPUS, critic: HAIKU },
      },
    ]);
    chooseGgMode();
    // `critic` is on its default of HAIKU, so Opus in `primary` is exactly the member
    // above.
    fireEvent.focus(screen.getByLabelText("primary"));
    expect(
      screen.queryByRole("option", { name: /Claude Opus 4.8/ }),
    ).toBeNull();
    expect(screen.getByRole("option", { name: /GPT-5.6 Sol/ })).toBeTruthy();
  });

  it("keeps offering a model whose other slots differ from the row on screen", () => {
    renderPicker([
      {
        harness: "gg",
        model: "",
        ggConfigId: "saved:cfg-1",
        ggConfigName: "Nightly",
        ggSlotModels: { primary: OPUS, critic: HAIKU },
      },
    ]);
    chooseGgMode();
    // A different reviewer's model makes this a different member — a second arm of the
    // same study, not a duplicate.
    typeModel("critic", SOL);
    fireEvent.focus(screen.getByLabelText("primary"));
    expect(
      screen.getByRole("option", { name: /Claude Opus 4.8/ }),
    ).toBeTruthy();
  });
});

// A member's pill has to say which combination it is without the reviewer opening
// anything: a gg member reads as the configuration they picked and the models it binds,
// never as the empty model id storage keeps for it.
describe("ComboPicker pills", () => {
  beforeEach(() => {
    authToken = "t";
    ggState = { options: [ggOption()], loading: false, error: null };
  });

  it("leaves a harness member reading as its model and provider", () => {
    renderPicker([
      { harness: "claude", model: "claude-opus-4-8", provider: "anthropic" },
    ]);
    expect(screen.getByText("claude-opus-4-8 · anthropic")).toBeTruthy();
  });
});

// A gg member is a configuration, the models it binds, and the slot each is bound to.
// The last is what tells two arms of one study apart and is more than a pill holds, so
// the members are rows that disclose their bindings under one heading rather than a
// block, a divider and a Clear all per configuration.
describe("ComboPicker gg members", () => {
  beforeEach(() => {
    authToken = "t";
    ggState = { options: [ggOption()], loading: false, error: null };
  });

  const ggMember = (
    slots: Record<string, string>,
    id = "cfg-1",
  ): ReviewPlanCombo => ({
    harness: "gg",
    model: "",
    ggConfigId: `saved:${id}`,
    ggSlotModels: slots,
  });

  /** The disclosure control of the member naming `config`. */
  const memberRow = (config: string | RegExp) =>
    screen.getByRole("button", { name: new RegExp(config) });

  it("gathers every gg member under one heading, whatever configuration it names", () => {
    ggState = {
      options: [ggOption(), ggOption("cfg-2", "Weekly")],
      loading: false,
      error: null,
    };
    renderPicker([
      ggMember({ primary: OPUS, critic: HAIKU }),
      ggMember({ primary: SOL }, "cfg-2"),
    ]);
    expect(screen.getByText("gg Configurations")).toBeTruthy();
    // The row names the configuration under its *current* name, resolved on render and
    // never stored on the member. "gg" names nothing and heads nothing.
    expect(screen.getAllByText("Nightly")).toHaveLength(1);
    expect(screen.getAllByText("Weekly")).toHaveLength(1);
    expect(screen.queryByText("gg")).toBeNull();
    expect(screen.getByText(`${HAIKU}, ${OPUS}`)).toBeTruthy();
  });

  // Two members of one configuration binding different models are two cells the plan
  // will run and two entries the reviewer can remove — never one row.
  it("gives each member its own row, not each configuration", () => {
    renderPicker([
      ggMember({ primary: OPUS, critic: HAIKU }),
      ggMember({ primary: SOL, critic: HAIKU }),
    ]);
    expect(screen.getAllByText("Nightly")).toHaveLength(2);
    expect(screen.getAllByText("gg Configurations")).toHaveLength(1);
  });

  it("drops every gg member on Clear all, and leaves the harness members alone", () => {
    ggState = {
      options: [ggOption(), ggOption("cfg-2", "Weekly")],
      loading: false,
      error: null,
    };
    const harness: ReviewPlanCombo = {
      harness: "claude",
      model: "claude-opus-4-8",
    };
    const onChange = renderPicker([
      ggMember({ primary: OPUS }),
      harness,
      ggMember({ primary: SOL }, "cfg-2"),
    ]);
    const block = screen
      .getByText("gg Configurations")
      .closest("div")!.parentElement!;
    fireEvent.click(within(block).getByRole("button", { name: "Clear all" }));
    expect(onChange).toHaveBeenCalledWith([harness]);
  });

  it("removes the member whose row was pressed, not its configuration's others", () => {
    const first = ggMember({ primary: OPUS, critic: HAIKU });
    const second = ggMember({ primary: SOL, critic: HAIKU });
    const onChange = renderPicker([first, second]);
    // Rows sort by configuration then by what they bind, so the Opus row leads.
    const rows = screen.getAllByRole("button", { name: "Remove combination" });
    fireEvent.click(rows[0]!);
    expect(onChange).toHaveBeenCalledWith([second]);
  });

  // The bindings are as many lines of model ids as the configuration has slots, so they
  // stay folded until asked for — and the row has to say it can be asked.
  it("discloses the slot each model is bound to", () => {
    renderPicker([ggMember({ primary: OPUS, critic: HAIKU })]);
    const row = memberRow("Nightly");
    expect(row.tagName).toBe("BUTTON");
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("primary")).toBeNull();

    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    // Slot by slot, so two members agreeing on their models and differing on which slot
    // runs which are told apart.
    expect(screen.getByText("primary")).toBeTruthy();
    expect(screen.getByText("critic")).toBeTruthy();
    expect(screen.getByText(OPUS)).toBeTruthy();
    // The panel it names exists while it is open.
    const panelId = row.getAttribute("aria-controls")!;
    expect(document.getElementById(panelId)).toBeTruthy();

    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("primary")).toBeNull();
  });

  // Nested, a press aimed at opening the row could land on the destructive control
  // instead. A click on the remove control is a removal and nothing else.
  it("keeps the remove control out of the row's hit area", () => {
    const onChange = renderPicker([ggMember({ primary: OPUS })]);
    const row = memberRow("Nightly");
    const remove = screen.getByRole("button", { name: "Remove combination" });
    expect(row.contains(remove)).toBe(false);
    fireEvent.click(remove);
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("says a configuration that pins every model itself binds none", () => {
    renderPicker([ggMember({})]);
    const row = memberRow("Nightly");
    expect(screen.getByText("pinned models")).toBeTruthy();
    fireEvent.click(row);
    expect(
      screen.getByText(/pins every model itself, so it binds none/),
    ).toBeTruthy();
  });

  // An unbound slot is exactly why the cell it makes can never launch, so the
  // disclosure names it rather than quietly leaving it out.
  it("names a slot nothing is bound to rather than omitting it", () => {
    renderPicker([ggMember({ primary: OPUS, critic: "" })]);
    fireEvent.click(memberRow("Nightly"));
    expect(screen.getByText("critic")).toBeTruthy();
    expect(screen.getByText("not bound")).toBeTruthy();
  });

  it("stays identifiable when the configuration it names is gone", () => {
    ggState = { options: [], loading: false, error: null };
    renderPicker([ggMember({ primary: OPUS })]);
    expect(screen.getByText("cfg-1")).toBeTruthy();
  });
});

// A pinned case is four fields, not three: the engine is a run dimension a version
// gates and a result is only comparable within, so a plan that could not ask for one
// could not express half the studies a reviewer wants to run. These cover the picker
// that writes that pin.
describe("CasePicker", () => {
  /** The one E2E case the catalog offers, at one version. */
  function caseSummary() {
    return {
      slug: "carom",
      name: "Carom",
      testType: "end-to-end",
      assetKind: null,
      difficulty: "easy",
      tags: [],
      summary: null,
      versions: ["v1.0.0"],
      latestVersion: "v1.0.0",
    };
  }

  function galleryValue(): GalleryDataInput {
    return {
      producedSummaries: [],
      localIds: new Set(),
      writeups: {},
      reviews: {},
      runsLoading: false,
      queryRunSummaries: async () => ({ summaries: [], total: 0 }),
      testCases: [caseSummary()],
      testCasesStatus: "ready",
      models: [],
      modelsStatus: "ready",
      canExecute: true,
    } as unknown as GalleryDataInput;
  }

  // The catalog the picker resolves against. `engines` is the compatibility gate the
  // Engine dropdown offers, so each test says what the version supports.
  function backendValue(engines: string[]) {
    return {
      client: {
        listTestCases: async () => [
          { slug: "carom", versions: ["v1.0.0"], name: "Carom" },
        ],
        resolveVersion: async () => ({
          slug: "carom",
          version: "v1.0.0",
          name: "Carom",
          variants: [{ slug: "base", name: "Base" }],
          engines,
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

  // A catalog that never answers with a version, which is what every editor renders
  // against for the first frames after it opens.
  function unresolvedBackendValue() {
    const value = backendValue([]);
    return {
      ...value,
      client: {
        ...value.client,
        resolveVersion: async () => null,
      } as unknown as BackendClient,
    };
  }

  // The catalog and the version both resolve asynchronously, so every render flushes
  // them before asserting — the Engine dropdown does not exist until the version does.
  async function renderCases(
    cases: ReviewPlanCase[] = [],
    engines: string[] = ["none", "simple-2d"],
    onChange = vi.fn(),
  ) {
    render(
      <MemoryRouter>
        <BackendProvider value={backendValue(engines)}>
          <GalleryDataProvider value={galleryValue()}>
            <CasePicker cases={cases} onChange={onChange} />
          </GalleryDataProvider>
        </BackendProvider>
      </MemoryRouter>,
    );
    await act(async () => {});
    return onChange;
  }

  const engineSelect = () =>
    screen.getByLabelText("Engine") as HTMLSelectElement;

  it("offers the engines the resolved version supports, named as the catalog names them", async () => {
    await renderCases();
    expect([...engineSelect().options].map((o) => o.textContent)).toEqual([
      "None",
      "Simple 2D",
    ]);
    // The engineless run leads, because it is the one every case supports.
    expect(engineSelect().value).toBe("none");
  });

  // Unlike the new-run form, which hides a field with nothing to choose: the pin is
  // what the reviewer is committing the plan to, and one they were never shown is one
  // they cannot check against the pill it produced.
  it("still names a single supported engine, read-only rather than hidden", async () => {
    await renderCases([], ["structured-2d"]);
    expect(engineSelect().value).toBe("structured-2d");
    expect(engineSelect()).toBeDisabled();
  });

  it("holds the choice to what the version supports rather than trusting it", async () => {
    // `none` is not on offer here, so the field cannot rest on it: a case built
    // against a runtime need not support the engineless run at all.
    await renderCases([], ["simple-2d", "structured-2d"]);
    expect(engineSelect().value).toBe("simple-2d");
  });

  it("sends the chosen engine on the pin it adds", async () => {
    const onChange = await renderCases();
    fireEvent.change(engineSelect(), { target: { value: "simple-2d" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
    expect(onChange).toHaveBeenCalledWith([
      {
        slug: "carom",
        version: "v1.0.0",
        variant: "base",
        engine: "simple-2d",
      },
    ]);
  });

  // Absent and `none` are the same pin to the server, so the engineless pin is written
  // exactly as it was before a pin carried an engine at all.
  it("omits the engine entirely for the engineless run", async () => {
    const onChange = await renderCases();
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
    expect(onChange).toHaveBeenCalledWith([
      { slug: "carom", version: "v1.0.0", variant: "base" },
    ]);
  });

  it("counts the same case on two engines as two cases", async () => {
    const onChange = await renderCases([
      { slug: "carom", version: "v1.0.0", variant: "base" },
    ]);
    fireEvent.change(engineSelect(), { target: { value: "simple-2d" } });
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
    expect(onChange).toHaveBeenCalledWith([
      { slug: "carom", version: "v1.0.0", variant: "base" },
      {
        slug: "carom",
        version: "v1.0.0",
        variant: "base",
        engine: "simple-2d",
      },
    ]);
  });

  it("still refuses the same case on the same engine", async () => {
    const onChange = await renderCases([
      { slug: "carom", version: "v1.0.0", variant: "base", engine: "none" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
    // `none` and an absent engine are one pin, so the second add is the same cell.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("names a pinned engine on the pill, and leaves the engineless one unnamed", async () => {
    await renderCases([
      { slug: "carom", version: "v1.0.0", variant: "base" },
      {
        slug: "carom",
        version: "v1.0.0",
        variant: "base",
        engine: "simple-2d",
      },
    ]);
    // Two pills that read alike are two the reviewer cannot tell apart — or remove
    // the right one of.
    expect(screen.getByText("Carom · base · v1.0.0")).toBeTruthy();
    expect(screen.getByText("Carom · base · v1.0.0 · Simple 2D")).toBeTruthy();
  });

  // The field is on screen from the first frame, before anything has resolved. A
  // select with no options paints as an empty box, and the reviewer would be reading
  // a blank engine off a row whose Add button files a perfectly real pin.
  it("names the engineless run rather than going blank before the version resolves", async () => {
    render(
      <MemoryRouter>
        <BackendProvider value={unresolvedBackendValue()}>
          <GalleryDataProvider value={galleryValue()}>
            <CasePicker cases={[]} onChange={vi.fn()} />
          </GalleryDataProvider>
        </BackendProvider>
      </MemoryRouter>,
    );
    await act(async () => {});
    expect(engineSelect().value).toBe("none");
    expect([...engineSelect().options].map((o) => o.textContent)).toEqual([
      "None",
    ]);
    expect(engineSelect()).toBeDisabled();
  });

  // The catalog says a version's `engines` is never empty, but the console is pointed
  // at hosts it does not control — a snapshot predating the field reports none. The
  // engineless run is what such a version supports, and it is what the pin will say.
  it("falls back to the engineless run for a version that declares no engine", async () => {
    const onChange = await renderCases([], []);
    expect(engineSelect().value).toBe("none");
    fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
    expect(onChange).toHaveBeenCalledWith([
      { slug: "carom", version: "v1.0.0", variant: "base" },
    ]);
  });
});
