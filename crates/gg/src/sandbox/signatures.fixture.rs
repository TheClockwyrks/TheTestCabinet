//! **One small surface**, written as a catalogue — the fixture every test of the doc model reads.
//!
//! It has no arm behind it, which is the point: the properties worth proving about the model are
//! about the *document* — that a catalogue projects into the same
//! [`CatalogueFunction`](super::CatalogueFunction) shape every consumer reads, and that each gate
//! written over it can be shown catching a damaged one — and giving them a component, a checker and
//! a healing dialect to hang off would be a great deal of apparatus for a question about JSON.
//!
//! # What the surface was chosen to be
//!
//! Four calls, one per kind of [binding](crate::sandbox::Binding) gg has — a tool
//! (`files.read_file`), an unconditional view (`views.close`), an ending (`session.finish`) and a
//! capability (`programs.get`) — so that the projection's gate synthesis is exercised on every arm of
//! the match rather than on the one that happened to be written down. They are real gg operations,
//! because an operation gg does not have would make the fixture prove the opposite of what it is for.
//!
//! Their shapes are deliberately not uniform: a free function, a **method** on a handle type, and a
//! **static method** whose owning class is the module itself — which is how a language with no
//! standalone functions spells what every other arm spells as one. That is the axis
//! [the name rule](super::fqn) has to survive, so it is in the fixture rather than only in prose.

use std::sync::OnceLock;

use serde_json::Value;

use super::{SchemaVersion, SignatureCatalogue};

/// The surface as a catalogue: modules, operations, fully-qualified names, authored briefs and
/// resolved type references.
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

/// The fixture, parsed once.
pub(crate) fn v2() -> &'static SignatureCatalogue {
    static PARSED: OnceLock<SignatureCatalogue> = OnceLock::new();
    let catalogue = PARSED.get_or_init(|| parse(V2));
    assert_eq!(catalogue.schema, SchemaVersion::V2);
    catalogue
}

/// The fixture with `edit` applied to it first — the damaged input every assertion that a gate
/// **catches** something is built from.
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
