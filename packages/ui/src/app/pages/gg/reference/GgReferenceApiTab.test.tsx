// The API tab.
//
// What is worth pinning here is the grouping. The functions arrive in catalogue order —
// which begins with the *ending* call, the last module — so a tree built by walking the
// function list would present gg's surface backwards. The tree is built by walking the
// **modules** instead, in the order the payload declares them, and this is the test that
// says so.
//
// The join between a folder and its functions is gg's module id, never the arm's spelling of
// it, so the fixture below deliberately carries both and they deliberately differ.
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { GgReference } from "@test-cabinet/run-record/gg-reference";
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

const REFERENCE: GgReference = {
  ggVersion: "9.9.9",
  language: "typescript",
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
    // A module the surface carries and nothing is callable in: every arm has one for the
    // declarations that belong to no capability. It must not become an empty folder.
    {
      id: "core",
      path: "gg.core",
      summary: "The types that belong to no one module.",
    },
  ],
  tools: [],
  functions: [
    // Catalogue order: the ending call comes first, and the tree must still put it last.
    {
      module: "session",
      fqn: "gg.session.finish",
      operation: "session.finish",
      name: "finish",
      category: "gg-session",
      summary: "End your session.",
      signatures: [
        {
          signature: "finish(summary: string): void",
          parameters: [
            {
              name: "summary",
              type: "string",
              optional: false,
              passing: "positional",
              doc: "What you did, in a sentence or two.",
              fields: [],
            },
          ],
        },
      ],
      doc: "End your session, reporting what you did.",
      ending: "standard",
      library: false,
      types: [],
    },
    {
      module: "session",
      fqn: "gg.session.approve",
      operation: "session.approve",
      name: "approve",
      category: "gg-session",
      summary: "Approve the work.",
      signatures: [
        {
          signature: "approve(summary: string): void",
          parameters: [
            {
              name: "summary",
              type: "string",
              optional: false,
              passing: "positional",
              doc: "Why the work is acceptable.",
              fields: [],
            },
          ],
        },
      ],
      doc: "Approve the issue's work.",
      ending: "review",
      library: false,
      types: [],
    },
    {
      module: "files",
      fqn: "gg.files.readFile",
      operation: "files.read_file",
      name: "readFile",
      category: "gg-filesystem",
      summary: "Read a file.",
      // Two shapes on one entry, the way a language that spells an optional argument as
      // an overload pair carries it. TypeScript's own catalogue carries one; the fixture
      // carries two so the rendering of the plural case is exercised by something.
      signatures: [
        {
          signature: "readFile(path: string): FileRead",
          parameters: [
            {
              name: "path",
              type: "string",
              optional: false,
              passing: "positional",
              doc: "The file to read.",
              fields: [],
            },
          ],
        },
        {
          signature:
            "readFile(path: string, options: { offset: number }): FileRead",
          parameters: [
            {
              name: "path",
              type: "string",
              optional: false,
              passing: "positional",
              doc: "The file to read.",
              fields: [],
            },
            {
              // Passed as a block, the way Ruby spells a long body:
              // `fs.writeFile(path) { ... }`. Its type is the block's RETURN, because
              // what a block is for is the value it hands back.
              name: "body",
              type: "-> string",
              optional: false,
              passing: "block",
              doc: "A block returning the text to write.",
              fields: [],
            },
            {
              // Passed by name, the way Python and Kotlin spell an optional argument.
              name: "options",
              type: "{ offset: number }",
              optional: true,
              passing: "keyword",
              doc: "The window of lines to read.",
              fields: [
                {
                  name: "offset",
                  type: "number",
                  optional: true,
                  passing: "positional",
                  doc: "The 1-based line to start at.",
                  fields: [],
                },
              ],
            },
          ],
        },
      ],
      doc: "Read a file and return its contents.",
      gate: "read_file",
      library: false,
      types: [
        {
          name: "FileRead",
          declaration: "interface FileRead {\n  text: string;\n}",
          doc: "What a read returned.",
          members: [{ name: "text", type: "string", doc: "The file's text." }],
        },
      ],
    },
  ],
};

const ggReference = vi.fn().mockResolvedValue(REFERENCE);

function backendValue(): BackendContextValue {
  return { client: { ggReference } } as unknown as BackendContextValue;
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

describe("GgReferenceApiTab", () => {
  it("groups by module in the payload's order, not in catalogue order", async () => {
    renderAt("/gg/reference/api");
    const sidebar = await screen.findByRole("navigation", {
      name: "API modules",
    });
    const folders = within(sidebar)
      .getAllByRole("button", { expanded: true })
      .map((button) => button.getAttribute("aria-label"));
    // The filesystem module first, though the ending call is the payload's first function —
    // and no folder for the module nothing is callable in.
    expect(folders).toEqual(["gg.files functions", "gg.session functions"]);
  });

  it("opens on the tree's first function, not the payload's", async () => {
    renderAt("/gg/reference/api");
    // `functions[0]` is the ending call — last module, last folder, far below the fold of a
    // sidebar that scrolls. Opening there would highlight a row nobody can see while the
    // visible top of the tree looked unselected.
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

  it("addresses a function by the name a lookup takes, and shows what binds it", async () => {
    renderAt("/gg/reference/api?fn=gg.files.readFile");
    expect(
      await screen.findByRole("heading", { name: "gg.files.readFile" }),
    ).toBeInTheDocument();
    expect(screen.getByText("bound by read_file")).toBeInTheDocument();
    expect(
      screen.getByText("readFile(path: string): FileRead"),
    ).toBeInTheDocument();
  });

  it("names gg's own operation beside the arm's spelling", async () => {
    // The one identity on the page that is the same in every language arm, and the string a
    // run's records name the call by — so a reader with this page open and a run's calls in
    // front of them is looking at the same identifier in both.
    renderAt("/gg/reference/api?fn=gg.files.readFile");
    await screen.findByRole("heading", { name: "gg.files.readFile" });
    expect(screen.getByText("files.read_file")).toBeInTheDocument();
  });

  it("shows the declarations a signature refers to, explained", async () => {
    renderAt("/gg/reference/api?fn=gg.files.readFile");
    await screen.findByRole("heading", { name: "gg.files.readFile" });
    expect(screen.getByText(/interface FileRead/)).toBeInTheDocument();
    expect(screen.getByText("What a read returned.")).toBeInTheDocument();
    expect(screen.getByText("The file's text.")).toBeInTheDocument();
  });

  it("does not claim a lookup appends the whole closure it lists", async () => {
    // The page shows the TRANSITIVE closure — every declaration the signature reaches — while
    // a run appends one level, gated by the agent's documentation mode. The note used to say
    // the two were the same thing, which is the surface that existed before `docViewTypes`,
    // and a reader sizing a run's per-lookup context cost from it overstates it several-fold.
    renderAt("/gg/reference/api?fn=gg.files.readFile");
    await screen.findByRole("heading", { name: "gg.files.readFile" });
    const note = screen.getByText(/transitively closed/).closest("p")!;
    expect(note.textContent).toMatch(/more than any one lookup appends/);
    expect(note.textContent).toMatch(/one.{0,3} level deep/);
    expect(note.textContent).toMatch(/return-and-parameters/);
    expect(note.textContent).toMatch(/\boff\b/);
  });

  it("shows every shape a function is offered in, and what each argument is for", async () => {
    renderAt("/gg/reference/api?fn=gg.files.readFile");
    await screen.findByRole("heading", { name: "gg.files.readFile" });
    // Both overloads, not just the first — showing one would tell a reader half of what
    // a program may write.
    expect(
      screen.getByText("readFile(path: string): FileRead"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "readFile(path: string, options: { offset: number }): FileRead",
      ),
    ).toBeInTheDocument();
    // And a structured argument's fields, nested under it.
    expect(
      screen.getByText("The window of lines to read."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("The 1-based line to start at."),
    ).toBeInTheDocument();
  });

  it("marks an argument a language passes by name, and only that one", async () => {
    renderAt("/gg/reference/api?fn=gg.files.readFile");
    await screen.findByRole("heading", { name: "gg.files.readFile" });
    // Exactly one row is keyword-passed in the fixture: `options` on the second shape.
    // Positional is every other argument, and a marker on all of them would say nothing.
    expect(screen.getAllByText("by name")).toHaveLength(1);
  });

  it("marks an argument a language passes as a block, and only that one", async () => {
    renderAt("/gg/reference/api?fn=gg.files.readFile");
    await screen.findByRole("heading", { name: "gg.files.readFile" });
    // The marker Ruby's overload groups produce. Without it the row would read as an
    // ordinary positional argument written in the parentheses, which is the one thing a
    // block is not.
    expect(screen.getAllByText("as a block")).toHaveLength(1);
    expect(
      screen.getByText("A block returning the text to write."),
    ).toBeInTheDocument();
  });

  it("names the ending role for a call a role binds rather than a tool", async () => {
    renderAt("/gg/reference/api?fn=gg.session.approve");
    expect(
      await screen.findByRole("heading", { name: "gg.session.approve" }),
    ).toBeInTheDocument();
    expect(screen.getByText("review ending")).toBeInTheDocument();
  });
});
