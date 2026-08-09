//! **One surface, written twice** — the matched pair of catalogues every test of the doc model
//! reads: the same four calls and two types in the [`V1`](SchemaVersion::V1) shape every arm commits
//! today, and in the [`V2`](SchemaVersion::V2) shape they are converted to.
//!
//! # Why a matched pair rather than two unrelated fixtures
//!
//! Because the property worth proving is not that each schema parses — that is a `serde` derive
//! working — but that **the two describe the same thing**, and that a consumer reading them through
//! [`catalogue_functions`](super::catalogue_functions) cannot tell which it was handed. That is the
//! whole basis on which an arm is converted in its own commit while the other ten stay where they
//! are, and it is only testable against two catalogues that are supposed to agree.
//!
//! So the two are written to agree deliberately, down to the prose: each v1 entry's `doc` is its v2
//! `brief`, a blank line, and its v2 `detail`, which is exactly the shape the
//! [transitional split](super::Prose::from_paragraph) recovers. Where they *cannot* agree, the tests
//! say so rather than the fixture papering over it — a v1 entry has no fully-qualified name, no
//! module and no return position, because its schema has nowhere to put one.
//!
//! # What the surface was chosen to be
//!
//! Four calls, one per kind of [binding](crate::sandbox::Binding) gg has — a tool
//! (`files.read_file`), an unconditional view (`views.close`), an ending (`session.finish`) and a
//! capability (`programs.get`) — so that the v2 projection's gate synthesis is exercised on every
//! arm of the match rather than on the one that happened to be written down. They are real gg
//! operations, because an operation gg does not have would make the fixture prove the opposite of
//! what it is for.
//!
//! Their v2 shapes are deliberately not uniform: a free function, a **method** on a handle type, and
//! a **static method** whose owning class is the module itself — which is how a language with no
//! standalone functions spells what every other arm spells as one. That is the axis
//! [the name rule](super::fqn) has to survive, so it is in the fixture rather than only in prose.

use std::sync::OnceLock;

use serde_json::Value;

use super::{SchemaVersion, SignatureCatalogue};

/// The surface in the [`V1`](SchemaVersion::V1) shape: six sections, an API object per entry, the
/// gate written on the entry, and one `doc` paragraph each.
pub(crate) const V1: &str = r#"{
  "language": "rust",
  "generatedFrom": "the doc model's own fixture — no SDK, no reflector",
  "objects": [
    { "object": "fs", "doc": "Read, write and edit files in the workspace." },
    { "object": "view", "doc": "Put material into the agent's own context window." },
    { "object": "harness", "doc": "End the session." },
    { "object": "programs", "doc": "The programs already run in this session." }
  ],
  "meta": [],
  "session": [
    {
      "key": "finish",
      "name": "finish",
      "object": "harness",
      "ending": "standard",
      "signatures": [
        {
          "signature": "finish(summary: &str)",
          "parameters": [
            { "name": "summary", "type": "&str", "optional": false, "kind": "positional",
              "default": null, "doc": "What was done, in a sentence or two.", "fields": [] }
          ]
        }
      ],
      "doc": "End the session, reporting what was done.\n\nIt does not stop the program: whatever follows it still runs.",
      "types": []
    }
  ],
  "views": [
    {
      "key": "close",
      "requires": null,
      "name": "close",
      "object": "view",
      "signatures": [
        {
          "signature": "close(selector: &str)",
          "parameters": [
            { "name": "selector", "type": "&str", "optional": false, "kind": "positional",
              "default": null, "doc": "Which views to take back out.", "fields": [] }
          ]
        }
      ],
      "doc": "Take a view back out of the context window.\n\nThe tokens it held are reclaimed for the turns that follow.",
      "types": ["OpenView"]
    }
  ],
  "programs": [
    {
      "key": "get",
      "name": "get",
      "object": "programs",
      "signatures": [
        {
          "signature": "get(id: &str) -> ProgramSummary",
          "parameters": [
            { "name": "id", "type": "&str", "optional": false, "kind": "positional",
              "default": null, "doc": "Which program to read back.", "fields": [] }
          ]
        }
      ],
      "doc": "Read one program that has already run.\n\nThe source is what executed, not what was written.",
      "types": []
    }
  ],
  "tools": [
    {
      "tool": "read_file",
      "name": "read_file",
      "object": "fs",
      "signatures": [
        {
          "signature": "read_file(path: &str) -> FileRead",
          "parameters": [
            { "name": "path", "type": "&str", "optional": false, "kind": "positional",
              "default": null, "doc": "The file to read, relative to the workspace.", "fields": [] }
          ]
        }
      ],
      "doc": "Read a file's bytes into the program.\n\nReading an image does not show it; opening a view of it does.",
      "types": ["FileRead"]
    }
  ],
  "helpers": [],
  "types": [
    {
      "name": "FileRead",
      "declaration": "enum FileRead { Text(String), Image(Vec<u8>) }",
      "doc": "The result of a file read.\n\nNarrow it before use: the two arms carry different things.",
      "members": [
        { "name": "Text", "type": null, "doc": "A text file, decoded." },
        { "name": "Image", "type": null, "doc": "An image file, as bytes." }
      ]
    },
    {
      "name": "OpenView",
      "declaration": "struct OpenView { selector: String }",
      "doc": "One view that is open right now.",
      "members": [
        { "name": "selector", "type": "String", "doc": "What the view was opened under." }
      ]
    }
  ]
}"#;

/// The same surface in the [`V2`](SchemaVersion::V2) shape: modules, operations, fully-qualified
/// names, authored briefs and resolved type references.
pub(crate) const V2: &str = r#"{
  "schema": 2,
  "language": "rust",
  "generatedFrom": "the doc model's own fixture — no SDK, no reflector",
  "modules": [
    {
      "id": "files",
      "path": "gg::files",
      "brief": "Read, write and edit files in the workspace.",
      "detail": "Every path is relative to the workspace root.",
      "import": null
    },
    { "id": "views", "path": "gg::views", "brief": "Put material into the agent's own context window.",
      "detail": null, "import": null },
    { "id": "session", "path": "gg::session", "brief": "End the session.", "detail": null,
      "import": null },
    { "id": "programs", "path": "gg::programs", "brief": "The programs already run in this session.",
      "detail": null, "import": "use gg::programs;" }
  ],
  "functions": [
    {
      "operation": "session.finish",
      "aliasOf": null,
      "module": "session",
      "kind": "function",
      "receiver": null,
      "name": "finish",
      "fqn": "gg::session::finish",
      "call": null,
      "brief": "End the session, reporting what was done.",
      "detail": "It does not stop the program: whatever follows it still runs.",
      "signatures": [
        {
          "signature": "finish(summary: &str)",
          "parameters": [
            { "name": "summary", "type": "&str", "optional": false, "kind": "positional",
              "default": null, "doc": "What was done, in a sentence or two.", "fields": [] }
          ]
        }
      ],
      "returns": [],
      "types": []
    },
    {
      "operation": "views.close",
      "aliasOf": null,
      "module": "views",
      "kind": "method",
      "receiver": "OpenView",
      "name": "close",
      "fqn": "gg::views::OpenView::close",
      "call": null,
      "brief": "Take a view back out of the context window.",
      "detail": "The tokens it held are reclaimed for the turns that follow.",
      "signatures": [
        {
          "signature": "close(selector: &str)",
          "parameters": [
            { "name": "selector", "type": "&str", "optional": false, "kind": "positional",
              "default": null, "doc": "Which views to take back out.", "fields": [] }
          ]
        }
      ],
      "returns": [],
      "types": ["gg::views::OpenView"]
    },
    {
      "operation": "programs.get",
      "aliasOf": null,
      "module": "programs",
      "kind": "static-method",
      "receiver": null,
      "name": "get",
      "fqn": "gg::programs::get",
      "call": null,
      "brief": "Read one program that has already run.",
      "detail": "The source is what executed, not what was written.",
      "signatures": [
        {
          "signature": "get(id: &str) -> ProgramSummary",
          "parameters": [
            { "name": "id", "type": "&str", "optional": false, "kind": "positional",
              "default": null, "doc": "Which program to read back.", "fields": [] }
          ]
        }
      ],
      "returns": [],
      "types": []
    },
    {
      "operation": "files.read_file",
      "aliasOf": null,
      "module": "files",
      "kind": "function",
      "receiver": null,
      "name": "read_file",
      "fqn": "gg::files::read_file",
      "call": null,
      "brief": "Read a file's bytes into the program.",
      "detail": "Reading an image does not show it; opening a view of it does.",
      "signatures": [
        {
          "signature": "read_file(path: &str) -> FileRead",
          "parameters": [
            { "name": "path", "type": "&str", "optional": false, "kind": "positional",
              "default": null, "doc": "The file to read, relative to the workspace.", "fields": [] }
          ]
        }
      ],
      "returns": ["gg::files::FileRead"],
      "types": [{ "spelled": "FileRead", "fqn": "gg::files::FileRead" }]
    }
  ],
  "types": [
    {
      "name": "FileRead",
      "fqn": "gg::files::FileRead",
      "module": "files",
      "declaration": "enum FileRead { Text(String), Image(Vec<u8>) }",
      "brief": "The result of a file read.",
      "detail": "Narrow it before use: the two arms carry different things.",
      "members": [
        { "name": "Text", "type": null, "kind": "variant", "brief": "A text file, decoded.",
          "detail": null },
        { "name": "Image", "type": null, "kind": "variant", "brief": "An image file, as bytes.",
          "detail": null }
      ],
      "memberFunctions": []
    },
    {
      "name": "OpenView",
      "fqn": "gg::views::OpenView",
      "module": "views",
      "declaration": "struct OpenView { selector: String }",
      "brief": "One view that is open right now.",
      "detail": null,
      "members": [
        { "name": "selector", "type": "String", "kind": "field",
          "brief": "What the view was opened under.", "detail": null }
      ],
      "memberFunctions": [
        {
          "operation": "views.close",
          "name": "close",
          "fqn": "gg::views::OpenView::close",
          "brief": "Take a view back out of the context window."
        }
      ]
    }
  ]
}"#;

/// The [`V1`](SchemaVersion::V1) fixture, parsed once.
pub(crate) fn v1() -> &'static SignatureCatalogue {
    static PARSED: OnceLock<SignatureCatalogue> = OnceLock::new();
    let catalogue = PARSED.get_or_init(|| parse(V1));
    assert_eq!(catalogue.schema, SchemaVersion::V1);
    catalogue
}

/// The [`V2`](SchemaVersion::V2) fixture, parsed once.
pub(crate) fn v2() -> &'static SignatureCatalogue {
    static PARSED: OnceLock<SignatureCatalogue> = OnceLock::new();
    let catalogue = PARSED.get_or_init(|| parse(V2));
    assert_eq!(catalogue.schema, SchemaVersion::V2);
    catalogue
}

/// The [`V2`](SchemaVersion::V2) fixture with `edit` applied to it first — the damaged input every
/// assertion that a gate **catches** something is built from.
///
/// Each call leaks one catalogue, which is what lets a single test hold a healthy fixture and a
/// damaged one at once and compare what each produces. A test binary that runs a handful of these
/// leaks a handful of catalogues and then exits, which is the same trade the
/// [fixture language](super::super::language::fixture) already makes.
pub(crate) fn v2_with(edit: impl FnOnce(&mut Value)) -> &'static SignatureCatalogue {
    let mut json: Value = serde_json::from_str(V2).expect("the v2 fixture is valid JSON");
    edit(&mut json);
    Box::leak(Box::new(parse(&json.to_string())))
}

/// Parse a fixture, panicking with the reason: a fixture that does not parse is a fixture nobody can
/// read a failure out of, and degrading it into an empty catalogue would make every gate below pass
/// vacuously.
fn parse(json: &str) -> SignatureCatalogue {
    SignatureCatalogue::parse(json).expect("the doc-model fixture is a well-formed catalogue")
}
