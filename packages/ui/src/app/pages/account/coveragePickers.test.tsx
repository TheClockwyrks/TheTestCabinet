import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GgCapabilitySet } from "@test-cabinet/run-record/gg";
import type { ReviewPlanCombo } from "@test-cabinet/run-record/coverage";
import type { Model } from "../../../client/types";
import { defaultOpeningTurn, emptyDraft } from "../runs/gg/ggConfigDraft";
import type { GgConfigOption } from "../runs/gg/useGgConfigs";
import {
  AxisPicker,
  BufferTargetField,
  ComboPicker,
  axisLabel,
} from "./coveragePickers";

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
// must not reach the console.
describe("AxisPicker", () => {
  it("labels the axes the way the console names them everywhere", () => {
    expect(axisLabel("case")).toBe("One case at a time");
    expect(axisLabel("combination")).toBe("One model at a time");
  });

  it("marks the current axis and reports the other when picked", () => {
    const onChange = vi.fn();
    render(<AxisPicker value="case" onChange={onChange} />);
    const options = screen.getAllByRole("radio");
    expect(options.map((o) => o.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
    ]);
    fireEvent.click(screen.getByText("One model at a time"));
    expect(onChange).toHaveBeenCalledWith("combination");
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
  fireEvent.click(screen.getByRole("radio", { name: "gg configuration" }));
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

  it("heads a gg member's block with its configuration and reads the pill as its models", () => {
    renderPicker([
      {
        harness: "gg",
        model: "",
        ggConfigId: "saved:cfg-1",
        ggSlotModels: { primary: OPUS, critic: HAIKU },
      },
    ]);
    // The block names the axis its pills vary within, which for a gg member is the
    // configuration — under the configuration's *current* name, resolved on render and
    // never stored on the member. "gg" names no axis and heads nothing.
    expect(screen.getByText("Nightly")).toBeTruthy();
    expect(screen.getByText(`${HAIKU}, ${OPUS}`)).toBeTruthy();
    expect(screen.queryByText("gg")).toBeNull();
  });

  it("scopes a gg block's Clear all to its own configuration", () => {
    ggState = {
      options: [ggOption(), ggOption("cfg-2", "Weekly")],
      loading: false,
      error: null,
    };
    const nightly: ReviewPlanCombo = {
      harness: "gg",
      model: "",
      ggConfigId: "saved:cfg-1",
      ggSlotModels: { primary: OPUS },
    };
    const weekly: ReviewPlanCombo = {
      harness: "gg",
      model: "",
      ggConfigId: "saved:cfg-2",
      ggSlotModels: { primary: SOL },
    };
    const onChange = renderPicker([nightly, weekly]);
    const block = screen.getByText("Nightly").closest("div")!;
    fireEvent.click(within(block).getByRole("button", { name: "Clear all" }));
    expect(onChange).toHaveBeenCalledWith([weekly]);
  });

  it("leaves a harness member reading as its model and provider", () => {
    renderPicker([
      { harness: "claude", model: "claude-opus-4-8", provider: "anthropic" },
    ]);
    expect(screen.getByText("claude-opus-4-8 · anthropic")).toBeTruthy();
  });
});
