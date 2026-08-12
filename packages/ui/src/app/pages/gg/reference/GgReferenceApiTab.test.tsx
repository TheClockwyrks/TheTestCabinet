// The API tab.
//
// Four kinds of property are worth pinning here, and every one of them is something the
// page would still *look* right without.
//
// **The grouping.** Entries arrive in catalogue order, whose first module is not the first
// folder, so a tree built by walking the entry list would present gg's surface in an order
// no model ever meets it in. The tree is built by walking the **modules**, and the join is
// gg's module id and never the arm's spelling of it — which is why every fixture below
// carries both and they deliberately differ.
//
// **The body.** The block on the page is the documentation view gg rendered, verbatim. If
// it ever became something the console assembled out of structured fields, the page would
// stop being what its own intro paragraph claims it is and nothing would look wrong.
//
// **The arm.** Eleven SDKs spell the same capabilities eleven ways, so picking one has to
// fetch that one's document and show that one's spellings — and has to keep the reader on
// the call they were reading, which is the whole motion the picker exists for. A
// fully-qualified name does not survive the switch, so the carry-over rides on gg's
// operation id for a call and on the folded declaration name for a type; both are covered,
// as is the arm that has no counterpart, and as is the two-hop sequence that a real defect
// hid in.
//
// **The links.** The type names beside a function are FQN references into the same
// document, not declarations expanded into it, and each says whether opening the function
// opens it — the one-level-deep answer gg itself computed, which the page used to
// approximate in a paragraph.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GgProgramLanguage } from "@test-cabinet/run-record/gg";
import type {
  GgReference,
  GgReferenceApi,
} from "@test-cabinet/run-record/gg-reference";
import {
  BackendProvider,
  type BackendContextValue,
} from "../../../../client/context";
import { GgReferencePage } from "./GgReferencePage";

vi.mock("../../../components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../../components/PromptHeader", () => ({
  PromptHeader: () => null,
}));

/**
 * A documentation view's body, as gg renders one: the signature, a line per argument, a
 * blank line, then the prose. Its layout is the model's and must survive to the page —
 * which is what makes it worth asserting on whole rather than on a phrase inside it.
 */
const TS_READ_FILE_BODY =
  "readFile(path: string, options?: ReadOptions): FileRead\n" +
  "  path: string — The file to read, relative to the workspace or absolute.\n" +
  "  options?: ReadOptions — The window of lines to read.\n\n" +
  "Read a file, as either text or a picture.";

const RUST_READ_FILE_BODY =
  "read_file(path: &str, options: files::ReadOptions) -> Result<files::FileRead, ToolError>\n" +
  "  path: &str — The file to read, relative to the workspace or absolute.\n\n" +
  "Read a file, as either a `FileRead::Text` or a `FileRead::Image`.";

const INDEX: GgReference = {
  ggVersion: "9.9.9",
  categories: [
    {
      id: "gg-filesystem",
      title: "Filesystem",
      description: "Reading, writing and editing files in the workspace.",
    },
    {
      id: "gg-session",
      title: "Ending the session",
      description: "Ending your session — the one call that does.",
    },
  ],
  tools: [],
  languages: [
    { id: "typescript", moduleCount: 3, functionCount: 3, typeCount: 2 },
    { id: "javascript", moduleCount: 3, functionCount: 3, typeCount: 2 },
    { id: "rust", moduleCount: 3, functionCount: 2, typeCount: 1 },
  ],
};

const TYPESCRIPT: GgReferenceApi = {
  ggVersion: "9.9.9",
  language: "typescript",
  modules: [
    {
      id: "files",
      path: "gg.files",
      summary: "Read, write, edit and list the files of the workspace.",
      category: "gg-filesystem",
    },
    {
      id: "session",
      path: "gg.session",
      summary: "End your session with the verdict your role may give.",
      category: "gg-session",
    },
    // The types-only module every arm has. It carries no call at all, so it is where a
    // tree built out of functions alone would have shown an empty folder — and where a
    // tree that dropped it would hide a declaration a reader can be handed.
    {
      id: "core",
      path: "gg.core",
      summary: "The types that belong to no one module.",
    },
  ],
  // Catalogue order: the ending call comes first, and the tree must still put it last.
  entries: [
    {
      kind: "function",
      fqn: "gg.session.finish",
      name: "finish",
      module: "session",
      category: "gg-session",
      brief: "End your session.",
      body: "finish(summary: string): void\n\nEnd your session, reporting what you did.",
      operation: "session.finish",
      ending: "standard",
    },
    {
      kind: "function",
      fqn: "gg.session.approve",
      name: "approve",
      module: "session",
      category: "gg-session",
      brief: "Approve the work.",
      body: "approve(summary: string): void\n\nApprove the issue's work.",
      operation: "session.approve",
      ending: "review",
    },
    {
      kind: "function",
      fqn: "gg.files.readFile",
      name: "readFile",
      module: "files",
      category: "gg-filesystem",
      brief: "Read a file, as either text or a picture.",
      body: TS_READ_FILE_BODY,
      operation: "files.read_file",
      gate: "read_file",
      // The transitive closure, of which the two "opens" sets are one-level subsets — the
      // discrepancy the page used to explain in a paragraph and now marks per row.
      types: ["gg.files.ReadOptions", "gg.files.FileRead", "gg.core.ToolError"],
      returns: ["gg.files.FileRead"],
      opensUnderReturn: ["gg.files.FileRead"],
      opensUnderReturnAndParameters: [
        "gg.files.ReadOptions",
        "gg.files.FileRead",
      ],
    },
    {
      kind: "type",
      fqn: "gg.files.FileRead",
      name: "FileRead",
      module: "files",
      category: "gg-filesystem",
      brief: "What a read returned.",
      body: "type FileRead = { text: string }\nWhat a read returned.\n  text: string — The file's text.",
    },
    {
      kind: "type",
      fqn: "gg.core.ToolError",
      name: "ToolError",
      module: "core",
      brief: "What a call rejects with.",
      body: "class ToolError extends Error\nWhat a call rejects with.",
    },
  ],
};

// The arm that spells everything exactly the way the one above does. gg really has such a
// pair — JavaScript's SDK is TypeScript's with the types erased — and it is the pair that
// makes a broken carry-over look like a working one, because a switch between them lands
// on the right entry whether or not anything was carried. So the fixture keeps it, and one
// test below hops through it deliberately.
const JAVASCRIPT: GgReferenceApi = {
  ...TYPESCRIPT,
  language: "javascript",
};

// The same surface, spelled the way Rust spells it — a different fully-qualified name for
// every entry, and one fewer of them, because the arms are idiomatic SDKs rather than
// eleven transliterations of one.
const RUST: GgReferenceApi = {
  ggVersion: "9.9.9",
  language: "rust",
  modules: [
    {
      id: "files",
      path: "gg::files",
      summary: "Read, write, edit and list the files of the workspace.",
      category: "gg-filesystem",
    },
    {
      id: "session",
      path: "gg::session",
      summary: "End your session with the verdict your role may give.",
      category: "gg-session",
    },
    {
      id: "core",
      path: "gg::core",
      summary: "The types that belong to no one module.",
      // The one arm that needs a line to bring the module into scope, so that the chip
      // rendering it is exercised by something.
      import: "use gg::core;",
    },
  ],
  entries: [
    {
      kind: "function",
      fqn: "gg::files::read_file",
      name: "read_file",
      module: "files",
      category: "gg-filesystem",
      brief:
        "Read a file, as either a `FileRead::Text` or a `FileRead::Image`.",
      body: RUST_READ_FILE_BODY,
      operation: "files.read_file",
      gate: "read_file",
      types: ["gg::files::FileRead"],
      returns: ["gg::files::FileRead"],
      opensUnderReturn: ["gg::files::FileRead"],
      opensUnderReturnAndParameters: ["gg::files::FileRead"],
    },
    {
      kind: "function",
      fqn: "gg::session::finish",
      name: "finish",
      module: "session",
      category: "gg-session",
      brief: "End your session.",
      body: "finish(summary: &str) -> Result<(), ToolError>\n\nEnd your session, reporting what you did.",
      operation: "session.finish",
      ending: "standard",
    },
    // The same declaration under this arm's house style — snake case where TypeScript
    // uses Pascal. A type has no operation to carry over by, so this is what the fold in
    // `findCounterpart` exists to match.
    {
      kind: "type",
      fqn: "gg::files::file_read",
      name: "file_read",
      module: "files",
      category: "gg-filesystem",
      brief: "What a read returned.",
      body: "enum file_read { Text(TextFile), Image(ImageFile) }\nWhat a read returned.",
    },
  ],
};

const ARMS: Record<string, GgReferenceApi> = {
  typescript: TYPESCRIPT,
  javascript: JAVASCRIPT,
  rust: RUST,
};

const ggReference = vi.fn();
const ggReferenceApi = vi.fn();

function backendValue(): BackendContextValue {
  return {
    client: { ggReference, ggReferenceApi },
  } as unknown as BackendContextValue;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BackendProvider value={backendValue()}>
        <Routes>
          <Route
            path="/gg/reference/api"
            element={<GgReferencePage tab="api" />}
          />
        </Routes>
      </BackendProvider>
    </MemoryRouter>,
  );
}

/** Click an arm in the picker and let both the pick and its fetch settle. */
async function pickArm(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
  });
}

describe("GgReferenceApiTab", () => {
  beforeEach(() => {
    ggReference.mockReset();
    ggReference.mockResolvedValue(INDEX);
    ggReferenceApi.mockReset();
    ggReferenceApi.mockImplementation((language: GgProgramLanguage) =>
      Promise.resolve(ARMS[language]),
    );
  });

  it("groups by module in the document's order, not in catalogue order", async () => {
    renderAt("/gg/reference/api");
    const sidebar = await screen.findByRole("navigation", {
      name: "API modules",
    });
    const folders = within(sidebar)
      .getAllByRole("button", { expanded: true })
      .map((button) => button.getAttribute("aria-label"));
    // The filesystem module first, though the ending call is the document's first entry.
    // The types-only module is a real folder now: it has no call, but it declares a shape
    // a program can be handed, and hiding it would hide that declaration entirely.
    expect(folders).toEqual([
      "gg.files entries",
      "gg.session entries",
      "gg.core entries",
    ]);
  });

  it("opens on the tree's first entry, not the document's", async () => {
    renderAt("/gg/reference/api");
    // `entries[0]` is the ending call — last module, far below the fold of a sidebar that
    // scrolls. Opening there would highlight a row nobody can see while the visible top of
    // the tree looked unselected.
    expect(
      await screen.findByRole("heading", { name: "gg.files.readFile" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "gg.session.finish" }),
    ).not.toBeInTheDocument();
  });

  it("captions each module with its own summary, not its family's", async () => {
    renderAt("/gg/reference/api");
    const sidebar = await screen.findByRole("navigation", {
      name: "API modules",
    });
    // The sentence the module's own declaration is introduced by — the one the model is
    // given — rather than the family's, which groups several modules and says less about
    // which folder a reader wants.
    expect(
      within(sidebar).getByText(
        "Read, write, edit and list the files of the workspace.",
      ),
    ).toBeInTheDocument();
  });

  it("shows the documentation view gg rendered, whole and unreflowed", async () => {
    renderAt("/gg/reference/api?fn=gg.files.readFile");
    await screen.findByRole("heading", { name: "gg.files.readFile" });
    // The whole block, byte for byte — not a phrase inside it. This is the assertion that
    // fails the day somebody rebuilds the signature and the argument list out of
    // structured fields, which is the one thing this surface must never do again.
    const body = screen.getByText(/Read a file, as either text or a picture/);
    expect(body.textContent).toBe(TS_READ_FILE_BODY);
  });

  it("addresses an entry by the name a lookup takes, and shows what binds it", async () => {
    renderAt("/gg/reference/api?fn=gg.files.readFile");
    expect(
      await screen.findByRole("heading", { name: "gg.files.readFile" }),
    ).toBeInTheDocument();
    expect(screen.getByText("bound by read_file")).toBeInTheDocument();
    // gg's own name for what the call does — the one identity that is the same in all
    // eleven arms, and the string a run's records name it by.
    expect(screen.getByText("files.read_file")).toBeInTheDocument();
  });

  it("links each declaration a signature reaches, saying which of them opens with it", async () => {
    renderAt("/gg/reference/api?fn=gg.files.readFile");
    await screen.findByRole("heading", { name: "gg.files.readFile" });
    // Names, not expanded declarations: the type's own entry is in this same document.
    const link = screen.getByRole("button", { name: "gg.files.FileRead" });
    const returned = link.closest("li")!;
    expect(
      within(returned).getByText("opens under return"),
    ).toBeInTheDocument();

    // The declaration that opens only in the wider mode is marked as such and NOT as one
    // the default mode appends — a reader sizing a lookup's context cost reads exactly
    // this distinction, and it is the one the page used to explain in a paragraph.
    const wider = screen.getByText("gg.files.ReadOptions").closest("li")!;
    expect(
      within(wider).getByText("opens under return-and-parameters"),
    ).toBeInTheDocument();
    expect(
      within(wider).queryByText("opens under return"),
    ).not.toBeInTheDocument();
    // And it is plain text, not a link: this fixture's document carries no entry for it,
    // and a page that linked anyway would promise a lookup it can see it cannot serve.
    expect(
      screen.queryByRole("button", { name: "gg.files.ReadOptions" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(link);
    });
    expect(
      screen.getByRole("heading", { name: "gg.files.FileRead" }),
    ).toBeInTheDocument();
  });

  it("names the ending role for a call a role binds rather than a tool", async () => {
    renderAt("/gg/reference/api?fn=gg.session.approve");
    expect(
      await screen.findByRole("heading", { name: "gg.session.approve" }),
    ).toBeInTheDocument();
    expect(screen.getByText("review ending")).toBeInTheDocument();
  });

  it("fetches the arm the address names, and only that one", async () => {
    renderAt("/gg/reference/api?lang=rust");
    expect(
      await screen.findByRole("heading", { name: "gg::files::read_file" }),
    ).toBeInTheDocument();
    expect(ggReferenceApi).toHaveBeenCalledTimes(1);
    expect(ggReferenceApi).toHaveBeenCalledWith("rust");
  });

  it("shows the picked arm's own spellings, and carries the call over", async () => {
    renderAt("/gg/reference/api?fn=gg.files.readFile");
    await screen.findByRole("heading", { name: "gg.files.readFile" });

    await pickArm("Rust");

    // The same operation, spelled the way Rust spells it — the reader is not dropped back
    // at the top of a document they did not ask to restart. The only vocabulary the two
    // documents share is `files.read_file`, and that is what did it.
    expect(
      await screen.findByRole("heading", { name: "gg::files::read_file" }),
    ).toBeInTheDocument();
    const body = screen.getByText(/FileRead::Text/);
    expect(body.textContent).toBe(RUST_READ_FILE_BODY);
    // The module's own spelling, everywhere the arm's spelling is shown.
    const sidebar = screen.getByRole("navigation", { name: "API modules" });
    expect(
      within(sidebar).getByRole("button", { name: "gg::files entries" }),
    ).toBeInTheDocument();
    expect(ggReferenceApi).toHaveBeenCalledWith("rust");
  });

  it("carries a declaration over by name when the arms spell identifiers differently", async () => {
    renderAt("/gg/reference/api?fn=gg.files.FileRead");
    await screen.findByRole("heading", { name: "gg.files.FileRead" });

    await pickArm("Rust");

    // A type has no operation to carry over by, so the fold on its own name is what finds
    // it: `FileRead` and `file_read` are one declaration written by two SDKs with
    // different house styles.
    expect(
      await screen.findByRole("heading", { name: "gg::files::file_read" }),
    ).toBeInTheDocument();
  });

  it("says so when the arm switched to carries no counterpart", async () => {
    renderAt("/gg/reference/api?fn=gg.session.approve");
    await screen.findByRole("heading", { name: "gg.session.approve" });

    await pickArm("Rust");

    // The Rust fixture binds no review ending. Landing the reader on something plausible
    // and wrong would be worse than saying the arm does not have it.
    expect(
      await screen.findByText(/carries nothing called/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "gg::session::finish" }),
    ).not.toBeInTheDocument();
  });

  it("carries the call over after an arm that spelled it the same way", async () => {
    // Two hops, and the first one is the point. This is a regression test for a real
    // defect, found by driving the page over gg's own eleven documents and lost by every
    // two-arm test written against fixtures.
    //
    // Picking an arm rewrites the address before the new document arrives, so there are
    // renders in which the address already names the new arm while the entries on screen
    // are still the arm just left — which of course resolves its own name exactly. Code
    // that let any exact match retire the carried identity threw it away in that window.
    // With one hop that is invisible, because the identity was not needed yet. It shows on
    // the *second* hop: the reader lands on Rust having carried nothing, and the page says
    // Rust has no `gg.files.readFile` — which is true, and not what was asked.
    renderAt("/gg/reference/api?fn=gg.files.readFile");
    await screen.findByRole("heading", { name: "gg.files.readFile" });

    // JavaScript spells the call exactly as TypeScript does, so this hop looks like a
    // no-op and is the one that used to poison the next.
    await pickArm("JavaScript");
    expect(
      await screen.findByRole("heading", { name: "gg.files.readFile" }),
    ).toBeInTheDocument();

    await pickArm("Rust");
    expect(
      await screen.findByRole("heading", { name: "gg::files::read_file" }),
    ).toBeInTheDocument();
  });

  it("shows no entry of the arm just left while the arm just picked is loading", async () => {
    // The document is fetched, so there is a real window between the pick and the answer.
    // Whatever fills it must not be the previous arm's entries: a reader comparing two
    // spellings of one call would read Rust's heading over TypeScript's body and believe
    // it, and this page's whole claim is that what is on it is what an agent sees.
    let deliver: (() => void) | null = null;
    ggReferenceApi.mockImplementation((language: GgProgramLanguage) => {
      if (language === "typescript") return Promise.resolve(TYPESCRIPT);
      return new Promise<GgReferenceApi>((resolve) => {
        deliver = () => resolve(RUST);
      });
    });

    renderAt("/gg/reference/api?fn=gg.files.readFile");
    await screen.findByRole("heading", { name: "gg.files.readFile" });

    await pickArm("Rust");
    expect(screen.getByText(/Loading the Rust surface/)).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "gg.files.readFile" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      deliver!();
    });
    expect(
      await screen.findByRole("heading", { name: "gg::files::read_file" }),
    ).toBeInTheDocument();
  });

  it("re-reads an arm it has already fetched from memory, not from the backend", async () => {
    renderAt("/gg/reference/api");
    await screen.findByRole("heading", { name: "gg.files.readFile" });
    await pickArm("Rust");
    await screen.findByRole("heading", { name: "gg::files::read_file" });
    await pickArm("TypeScript");
    await screen.findByRole("heading", { name: "gg.files.readFile" });

    // Two arms, two requests — the third view of an immutable document costs nothing.
    // Comparing two arms' spellings of one call is the motion this picker exists for, and
    // a fetch each way would punish exactly it.
    expect(ggReferenceApi).toHaveBeenCalledTimes(2);
  });

  it("refuses an arm this deployment's gg does not register", async () => {
    renderAt("/gg/reference/api?lang=cobol");
    // Emphatically not a silent fall back to the first arm: a link written against a gg
    // that had an arm this one does not is exactly how that gets noticed.
    expect(
      await screen.findByText(/registers no program language called/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "gg.files.readFile" }),
    ).not.toBeInTheDocument();
    expect(ggReferenceApi).not.toHaveBeenCalled();
  });

  it("filters the tree without reordering it, and says what it is not", async () => {
    renderAt("/gg/reference/api");
    const filter = await screen.findByRole("searchbox", {
      name: "Filter this arm's surface",
    });
    await act(async () => {
      fireEvent.change(filter, { target: { value: "picture" } });
    });
    const sidebar = screen.getByRole("navigation", { name: "API modules" });
    // "picture" appears only in `readFile`'s body — the filter reads the body, because
    // what a reader half-remembers about a call is as often a phrase from its description
    // as its spelling.
    expect(
      within(sidebar).getAllByRole("button", { expanded: true }),
    ).toHaveLength(1);
    expect(
      within(sidebar).getByRole("button", {
        name: "function gg.files.readFile",
      }),
    ).toBeInTheDocument();
    // And the caption keeping it apart from gg's own search, which ranks its hits and
    // returns only what a run granted.
    expect(within(sidebar).getByText(/Hides rows here/)).toBeInTheDocument();
  });

  it("says an empty arm document is a broken projection, not a filter miss", async () => {
    // A document that decodes and carries nothing is served `200` — the backend warns and
    // serves it, because one hollow arm must not cost the page. Rendered as a tree it
    // would be no rows and the sidebar's "Nothing on this arm matches that.", which blames
    // the reader's filter for a file that is broken in the deployment. There is no such
    // thing as a legitimately empty arm: every registered one carries at least the
    // types-only module.
    ggReferenceApi.mockImplementation((language: GgProgramLanguage) =>
      Promise.resolve(
        language === "rust"
          ? { ...RUST, modules: [], entries: [] }
          : ARMS[language],
      ),
    );
    renderAt("/gg/reference/api?lang=rust");

    expect(
      await screen.findByText(/document for the Rust arm .* is empty/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Nothing on this arm matches/),
    ).not.toBeInTheDocument();
    // And no sentence about a name the reader never typed.
    expect(screen.queryByText(/carries nothing called/)).not.toBeInTheDocument();
  });

  it("does not take the pane away from a reader who is filtering", async () => {
    renderAt("/gg/reference/api");
    const filter = await screen.findByRole("searchbox", {
      name: "Filter this arm's surface",
    });
    await act(async () => {
      fireEvent.change(filter, { target: { value: "nothing matches this" } });
    });

    // The empty result is said in the sidebar, where the tree is — and the entry the
    // reader was reading is still under it. Deriving the pane's default from the filtered
    // tree would blank it here, which is losing the thing you were reading as a side
    // effect of looking something up.
    const sidebar = screen.getByRole("navigation", { name: "API modules" });
    expect(
      within(sidebar).getByText(/Nothing on this arm matches/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "gg.files.readFile" }),
    ).toBeInTheDocument();
  });
});
