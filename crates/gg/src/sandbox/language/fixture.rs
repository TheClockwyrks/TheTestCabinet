//! **The fixture language** — a second [`ProgramLanguage`] that exists only under `#[cfg(test)]`,
//! so that the seam has more than one implementation to be an abstraction *over*.
//!
//! # Why a fixture language exists at all
//!
//! A trait with exactly one implementation is not an abstraction; it is one implementation wearing a
//! trait, and nothing distinguishes the two until a second one arrives. Every property the
//! [seam](super) claims — that the healing skeleton asks a dialect rather than knowing TypeScript's
//! answers, that the prompt is selected per language rather than shared, that one language's
//! committed artifacts cannot reach another's consumer, that the
//! [agreement gate](super::agreement) compares two surfaces rather than one surface to itself —
//! is unfalsifiable while TypeScript is the only thing that implements it. The fixture is what
//! makes them falsifiable, a workflow before a second real language exists rather than a workflow
//! after.
//!
//! # What it is
//!
//! A stand-in for the *shape* a second language would take, deliberately not an imitation of any
//! particular one:
//!
//! * **Its spellings are snake_case.** They are derived, at test time, from TypeScript's own
//!   committed catalogue by re-spelling every entry's `name` and the head of its `signature`, and
//!   changing nothing else — not a `key`, not an `object`, not a gate, not an `ending`. So the
//!   fixture is by construction *the same capability surface under different spellings*, which is
//!   exactly what an A/B study across languages needs both arms to be, and what the agreement gate
//!   must therefore accept. Deriving it also means it cannot rot: a tool added to gg appears in
//!   both catalogues on the same day.
//! * **Its syntax is line-oriented**: `#` starts a comment, `use x` imports, `def f` declares, and
//!   `??` is not a token. Nothing evaluates it — no component is ever compiled from
//!   [`guest_component`](ProgramLanguage::guest_component) — because everything under test here
//!   happens strictly *before* a guest: preparing, healing, prompting, cataloguing.
//! * **It has no wire id.** [`id`](ProgramLanguage::id) panics, on purpose: a
//!   [`GgProgramLanguage`](test_cabinet_core::gg::GgProgramLanguage) is a value an operator
//!   configures, a run records and a study slices by, and a fixture that could be named in a config
//!   file would be a fixture that could be *run*. The panic is also load-bearing as a test: it is
//!   what proves the fixture never reaches the one production path that keys on the wire id — the
//!   [component cache](crate::sandbox::engine) — because that path would panic loudly rather than
//!   quietly serving it TypeScript's compiled component out of TypeScript's slot.
//!
//! # Where it is *not*
//!
//! It is not in [`language`](super::language), not in [`all_languages`](super::all_languages), and
//! not reachable from any `cfg`-free path. `all_languages()` stays derived from
//! `GgProgramLanguage::ALL`, so the gates that iterate it keep costing exactly what the registered
//! set costs, and no production reader can be handed a language that does not exist.
//! [`fixture_languages`](super::fixture_languages) is the one accessor, `#[cfg(test)]` like
//! everything here, and its only production-side consumer is the `#[cfg(test)]` arm of the prompt
//! engine's template registration.

use std::sync::OnceLock;

use serde_json::{Value, json};
use test_cabinet_core::gg::GgProgramLanguage;

use crate::healing::{CodeMask, Dialect, Unwrapped};
use crate::sandbox::signatures::SignatureCatalogue;

use super::{
    FileWindow, PrepareError, PrepareFailure, PreparedModule, PreparedProgram, ProgramLanguage,
    PromptDialect, VIEW_OPEN_DOCS_VIEW, VIEW_OPEN_FILE, spell,
};

/// TypeScript's committed catalogue, read a second time rather than reached for through
/// [`TypeScript::catalogue`](super::typescript) — the fixture re-spells the *file*, and taking it
/// from the file keeps this module from needing anything of another language's module to be public.
const TYPESCRIPT_SIGNATURES: &str = include_str!("../guests/typescript.signatures.json");

/// The stub that stands where a real language's component would be.
///
/// It is not a component and is never compiled: every consumer exercised against the fixture works
/// on text and catalogues, strictly before a guest. It is deliberately *different bytes* from
/// TypeScript's, which is what the "no language serves another's artifacts" assertion compares.
const COMPONENT: &[u8] = b"gg fixture language: not a component, never compiled";

/// The word that makes this language's "checker" reject a program it parsed cleanly — the fixture's
/// stand-in for a type error, which is the failure a checked language has and TypeScript does not.
pub(crate) const MISTYPED: &str = "mistyped";

/// The word that makes this language's "compiler" fall over instead of answering — the fixture's
/// stand-in for a `swiftc` that segfaults, a compile killed by its timeout, or a toolchain binary
/// that is not in the image. Nothing is decided about the program.
pub(crate) const NO_COMPILER: &str = "nocompiler";

// ---------------------------------------------------------------------------------------------
// The language
// ---------------------------------------------------------------------------------------------

/// A second implementation of the [seam](ProgramLanguage), for tests only.
///
/// The catalogue is per instance rather than per process because the [teeth
/// tests](super::agreement) need instances that *disagree*: [`a_language_whose_catalogue`] hands
/// back a fixture built from a deliberately damaged catalogue, and each one has to be able to
/// coexist with the agreeing one inside a single test.
pub(crate) struct FixtureLanguage {
    /// This instance's catalogue, leaked so it can be handed out as `&'static`.
    catalogue: &'static SignatureCatalogue,
    /// What this instance answers [`prepare_compiles`](ProgramLanguage::prepare_compiles) with.
    ///
    /// Per instance because both answers now need a subject. Every *registered* language compiles —
    /// TypeScript runs `tsc` over the model's program — so without a fixture that says `false`, the
    /// seam's other branch would be a promise nothing exercises: that a language which compiles
    /// nothing reports **nothing** rather than a zero.
    compiles: bool,
}

impl ProgramLanguage for FixtureLanguage {
    /// **Panics.** The fixture has no wire id; see this module's documentation for why that is the
    /// design rather than an omission.
    fn id(&self) -> GgProgramLanguage {
        panic!(
            "the fixture language has no wire id: it is never configured, resolved, recorded or \
             compiled, and anything that keys on `GgProgramLanguage` is a path it must not reach"
        )
    }

    fn display_name(&self) -> &'static str {
        "Fixture"
    }

    /// Strip comments, refuse an import, refuse a token the fixture's grammar does not have — and
    /// stand in for the two failures only a **compiled** language has.
    ///
    /// Deliberately unlike TypeScript's in both directions: a `#` comment prepares cleanly here and
    /// is a syntax error there, while a type annotation is erased there and passed through
    /// untouched here. That asymmetry is what the "preparation is the language's" assertions read.
    ///
    /// The last two checks are the fixture's whole reason for declaring that it
    /// [compiles](Self::prepare_compiles). A source mentioning [`MISTYPED`] is a program this
    /// language's checker read and rejected — a [`PrepareError::Compile`], which the model is shown
    /// and can fix. A source mentioning [`NO_COMPILER`] is the compiler itself falling over — a
    /// [`PrepareFailure::Toolchain`], which the model is *not* blamed for. No registered language
    /// produces either yet, so without a fixture that does, the split between them would be a
    /// taxonomy nothing had ever exercised.
    fn prepare_program(&self, source: &str) -> Result<PreparedProgram, PrepareFailure> {
        if source.contains("??") {
            return Err(
                PrepareError::Syntax("`??` is not a token in this language".to_string()).into(),
            );
        }
        if let Some(line) = source.lines().find(|line| is_use(line)) {
            return Err(PrepareError::Unsupported(format!(
                "there is no module loader here, so `{}` cannot be resolved",
                line.trim()
            ))
            .into());
        }
        if source.contains(NO_COMPILER) {
            return Err(PrepareFailure::Toolchain(
                "`fixturec` exited with signal 11 (SIGSEGV)".to_string(),
            ));
        }
        if source.contains(MISTYPED) {
            return Err(PrepareError::Compile(format!(
                "line 1: `{MISTYPED}` is not assignable to `Word`"
            ))
            .into());
        }
        Ok(PreparedProgram {
            source: strip_comments(source),
            unreachable: None,
        })
    }

    /// Whatever this instance was built to answer.
    ///
    /// The agreeing fixture says `true` and stands in for the **compiled** shape of a second
    /// language — it compiles nothing, of course, since nothing here evaluates anything, but that is
    /// what makes "a language that compiles has its programs timed, including the one its compiler
    /// rejected" an assertion rather than a promise.
    /// [`a_language_that_does_not_compile`] says `false` and is the only subject the opposite claim
    /// has left, now that every registered language compiles.
    fn prepare_compiles(&self) -> bool {
        self.compiles
    }

    /// A module's namespace is whatever it `def`s, and its prepared source says so in a trailing
    /// comment — the fixture's analogue of the `return { … }` epilogue TypeScript generates.
    fn prepare_module(&self, source: &str) -> Result<PreparedModule, PrepareFailure> {
        let prepared = self.prepare_program(source)?;
        let exports: Vec<String> = prepared
            .source
            .lines()
            .filter_map(|line| line.trim().strip_prefix("def "))
            .map(|rest| {
                rest.split(['(', ' '])
                    .next()
                    .unwrap_or_default()
                    .trim()
                    .to_string()
            })
            .filter(|name| !name.is_empty())
            .collect();
        Ok(PreparedModule {
            source: format!("{}\n# exports: {}", prepared.source, exports.join(", ")),
            exports,
        })
    }

    fn guest_component(&self) -> &'static [u8] {
        COMPONENT
    }

    fn catalogue(&self) -> &'static SignatureCatalogue {
        self.catalogue
    }

    fn healing(&self) -> &'static dyn Dialect {
        &FIXTURE_DIALECT
    }

    fn prompt(&self) -> &'static PromptDialect {
        &PROMPT
    }

    /// `csv-tools` → `csv_tools` — this language's own convention, and deliberately not
    /// TypeScript's, so "the binding key is the language's" is an assertion rather than a
    /// restatement of one implementation.
    fn binding_name(&self, name: &str) -> String {
        let out: String = name
            .chars()
            .map(|ch| {
                if ch.is_ascii_alphanumeric() {
                    ch.to_ascii_lowercase()
                } else {
                    '_'
                }
            })
            .collect();
        if out.is_empty() {
            "module".to_string()
        } else {
            out
        }
    }

    /// `view.open_file("src/main.fx")`, with a window as **keyword arguments** and no terminator.
    ///
    /// Deliberately unlike TypeScript's in all three of the ways a language is free to differ — the
    /// function's spelling, the idiom for an optional argument, and how a statement ends — which is
    /// what makes "the synthesized turn is written in the agent's own language" an assertion rather
    /// than a restatement of one implementation.
    fn open_file_statement(&self, path: &str, window: Option<FileWindow>) -> String {
        let open_file = spell(self, VIEW_OPEN_FILE);
        let path = Value::String(path.to_string());
        match window {
            Some(window) => format!(
                "{open_file}({path}, offset={}, limit={})",
                window.offset, window.limit
            ),
            None => format!("{open_file}({path})"),
        }
    }

    /// One statement per name, with no list literal and no loop — deliberately unlike TypeScript's,
    /// because "the program gg generates is written in the agent's own language" is only an
    /// assertion while two languages generate different programs.
    fn open_docs_views_statement(&self, names: &[&str]) -> String {
        let open_docs_view = spell(self, VIEW_OPEN_DOCS_VIEW);
        names
            .iter()
            .map(|name| format!("{open_docs_view}({})\n", Value::String((*name).to_string())))
            .collect()
    }
}

/// The one agreeing fixture: TypeScript's surface, re-spelled, and nothing else changed.
pub(crate) fn fixture_language() -> &'static FixtureLanguage {
    static FIXTURE: OnceLock<FixtureLanguage> = OnceLock::new();
    FIXTURE.get_or_init(|| FixtureLanguage {
        catalogue: leak(respelled_catalogue(|_| {})),
        compiles: true,
    })
}

/// The agreeing fixture's surface, from a language whose prepare step **compiles nothing**.
///
/// The subject of every assertion about the free branch of the seam: that such a language reports
/// `None` for what preparing a program cost, rather than `Some(0)`. The two are different claims —
/// "compiled, in under a millisecond" against "there is no compiler on this path at all" — and a
/// zero on every turn of every run would put a column of noise in front of the one study the field
/// exists for.
pub(crate) fn a_language_that_does_not_compile() -> &'static FixtureLanguage {
    static FIXTURE: OnceLock<FixtureLanguage> = OnceLock::new();
    FIXTURE.get_or_init(|| FixtureLanguage {
        catalogue: leak(respelled_catalogue(|_| {})),
        compiles: false,
    })
}

/// A fixture whose catalogue has been damaged by `edit` — the input to every assertion that the
/// [agreement gate](super::agreement) has teeth.
///
/// Each call leaks one catalogue, which is what lets a single test hold a healthy fixture and a
/// damaged one at once. A test binary that runs a handful of these leaks a handful of catalogues
/// and then exits.
pub(crate) fn a_language_whose_catalogue(
    edit: impl FnOnce(&mut Value),
) -> &'static FixtureLanguage {
    Box::leak(Box::new(FixtureLanguage {
        catalogue: leak(respelled_catalogue(edit)),
        compiles: true,
    }))
}

/// Every fixture language, for the `#[cfg(test)]` consumers that must know about them — today, the
/// prompt engine, which cannot render a template it never registered.
pub(crate) fn fixture_languages() -> impl Iterator<Item = &'static dyn ProgramLanguage> {
    std::iter::once(fixture_language() as &'static dyn ProgramLanguage)
}

// ---------------------------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------------------------

/// TypeScript's catalogue with every spelling converted to snake_case and `edit` applied, as JSON.
///
/// Only two fields move: an entry's `name`, and the head of each of its `signatures`, which by the
/// catalogue's own rule begins with that name. Identity — `key`, `tool`, `object`, `requires`,
/// `ending` — is copied verbatim, because identity is precisely what the agreement gate says two
/// languages may not differ on, and a fixture that differed on it would make the gate vacuous.
///
/// The *shape* of the call is copied verbatim too — parameter names, their descriptions, how many
/// signatures an entry carries — even though every one of those is spelling the fixture would be
/// free to change. Deriving means never rotting, and a fixture that also renamed arguments would
/// have to re-derive the descriptions to keep them honest. The divergence a *real* second language
/// brings is exercised by the [agreement gate's own tests](super::agreement::tests), which build a
/// catalogue whose arguments are renamed and whose optional argument is an overload pair, and assert
/// that it still agrees.
///
/// The root `language` field is the one thing that cannot be re-spelled: it is the wire enum, and
/// the fixture has no value in it. That is why catalogue provenance is asserted over *registered*
/// languages only.
fn respelled_catalogue(edit: impl FnOnce(&mut Value)) -> String {
    let mut document: Value = serde_json::from_str(TYPESCRIPT_SIGNATURES)
        .expect("the committed TypeScript catalogue is valid JSON");
    for section in ["meta", "session", "views", "programs", "tools", "helpers"] {
        let entries = document[section]
            .as_array_mut()
            .unwrap_or_else(|| panic!("the catalogue's `{section}` is an array"));
        for entry in entries {
            let name = entry["name"]
                .as_str()
                .expect("every entry names the function a program calls")
                .to_string();
            let respelled = snake_case(&name);
            let signatures = entry["signatures"]
                .as_array_mut()
                .expect("every entry carries at least one signature");
            for shape in signatures {
                let signature = shape["signature"]
                    .as_str()
                    .expect("every signature is a string")
                    .to_string();
                shape["signature"] = json!(match signature.strip_prefix(name.as_str()) {
                    Some(rest) => format!("{respelled}{rest}"),
                    None => signature,
                });
            }
            entry["name"] = json!(respelled);
        }
    }
    edit(&mut document);
    document.to_string()
}

/// `readFile` → `read_file`. The whole of the fixture's "language design".
fn snake_case(name: &str) -> String {
    let mut out = String::with_capacity(name.len() + 4);
    for character in name.chars() {
        if character.is_ascii_uppercase() {
            if !out.is_empty() {
                out.push('_');
            }
            out.push(character.to_ascii_lowercase());
        } else {
            out.push(character);
        }
    }
    out
}

/// Parse a catalogue and leak it, so a per-instance catalogue can satisfy the `&'static` the trait
/// hands out. Tests are short-lived processes; a leaked catalogue is freed by exiting.
fn leak(json: String) -> &'static SignatureCatalogue {
    Box::leak(Box::new(
        SignatureCatalogue::parse(&json).expect("the fixture catalogue is well-formed"),
    ))
}

// ---------------------------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------------------------

/// The fixture's model-facing prose, written in the fixture's spellings.
///
/// It is short — no language's real prompt is — but it carries the two things the per-language
/// prompt tests read: headings the shared machinery has to render, and spellings that must be *this*
/// language's rather than the other one's.
static PROMPT: PromptDialect = PromptDialect {
    system_template: FIXTURE_SYSTEM_TEMPLATE,
    system_template_name: "system-code.fixture",
    nothing_shown_template: "Your program showed you nothing. Call `{{api.view.open_text.call}}`.",
    nothing_shown_template_name: "code-nothing-shown.fixture",
};

/// The fixture's system prompt: enough Handlebars to prove the shared context renders against a
/// template gg did not write in TypeScript, and enough resolved spellings to prove the right
/// language's catalogue answered.
///
/// Every call in it is a `{{api.…}}` reference, exactly as TypeScript's template is written, which is
/// what makes "a template carries no spelling of its own" an assertion over two surfaces rather than
/// over one.
const FIXTURE_SYSTEM_TEMPLATE: &str = "\
## Responses as Code

Answer with a program in the fixture language. Comments start with `#`.

### Ending your session

Call `{{ending.finish}}(summary)`.

### Your APIs

{{#each apis}}- `{{object}}` — {{description}}
{{/each}}

Read a file with `{{api.fs.read_file.call}}(path)` and show yourself something with \
`{{api.view.open_text.signature}}`. Every object also carries `{{meta.list.name}}()`.
";

// ---------------------------------------------------------------------------------------------
// The healing dialect
// ---------------------------------------------------------------------------------------------

/// The fixture's [dialect](Dialect): the same questions, different answers.
///
/// Every method here disagrees with TypeScript's on some input the tests exercise — a different
/// fence tag, a different import keyword, a different declaration form — which is what turns "the
/// skeleton asks the dialect" from a claim into an observation.
pub(crate) static FIXTURE_DIALECT: FixtureDialect = FixtureDialect;

/// The fixture language's lexical rules.
pub(crate) struct FixtureDialect;

impl Dialect for FixtureDialect {
    /// Not `ts`. A reply carrying one fenced block of each language's is the crispest evidence that
    /// the tag list is read from the dialect and not from a constant in the skeleton.
    fn program_fence_tags(&self) -> &'static [&'static str] {
        &["fixture", "fx"]
    }

    fn looks_like_code(&self, line: &str) -> bool {
        let trimmed = line.trim();
        trimmed.starts_with("def ")
            || trimmed.starts_with('#')
            || is_use(trimmed)
            || trimmed.contains(" = ")
    }

    fn is_prose_line(&self, line: &str) -> bool {
        let trimmed = line.trim();
        trimmed.ends_with('.') && trimmed.contains(' ') && !trimmed.contains('=')
    }

    /// Everything is code except a `#` comment's run to the end of its line. The fixture language
    /// has no string literals, which is itself a difference worth having: a dialect is allowed to
    /// answer a question its language does not raise.
    fn code_mask(&self, src: &str) -> Option<CodeMask> {
        let mut flags = Vec::with_capacity(src.len());
        let mut in_comment = false;
        for byte in src.bytes() {
            match byte {
                b'#' => in_comment = true,
                b'\n' => in_comment = false,
                _ => {}
            }
            flags.push(!in_comment && byte != b'#');
        }
        Some(CodeMask::from_flags(flags))
    }

    /// `use x`, not `import x from "y"`.
    fn is_import_statement(&self, line: &str) -> bool {
        is_use(line.trim())
    }

    fn declares_a_redeclarable_binding(&self, text: &str, mask: &CodeMask, base: usize) -> bool {
        let mut offset = 0;
        for line in text.split_inclusive('\n') {
            let indent = line.len() - line.trim_start().len();
            if line.trim_start().starts_with("def ") && mask.is_code(base + offset + indent) {
                return true;
            }
            offset += line.len();
        }
        false
    }

    /// `None`, always: the fixture language has no concurrency construct to unwrap.
    ///
    /// A legal answer, and one worth having a non-inert dialect give — it is the shape of every
    /// language whose programs are synchronous by construction, and it keeps `unwrap-async` from
    /// looking like a step every dialect must implement.
    fn unwrap_async(&self, _text: &str, _mask: &CodeMask) -> Option<Unwrapped> {
        None
    }

    /// Replies in this language that the delete-only invariant is re-asserted over.
    ///
    /// One per repair the dialect can drive, plus the shapes where it must decline: a fenced
    /// program, prose around a bare one, a `use` line to drop, a doubled `def`, and a reply that is
    /// nothing but prose.
    fn fixtures(&self) -> &'static [&'static str] {
        &[
            "Here is the program.\n\n```fixture\ndef main\n  total = 1 + 2\n```\n\nThat should do it.",
            "```fx\nuse tools\ntotal = 1 + 2\n```",
            "def main\n  total = 1 + 2\n\ndef main\n  total = 1 + 2",
            "use tools\ndef main\n  x = 1 # a comment\n",
            "I have finished the task. Everything works.",
            "",
        ]
    }
}

// ---------------------------------------------------------------------------------------------
// The fixture language's own grammar helpers
// ---------------------------------------------------------------------------------------------

/// Whether a trimmed line is the fixture language's module import.
fn is_use(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed
        .strip_prefix("use ")
        .is_some_and(|rest| !rest.trim().is_empty())
}

/// Drop each line's `#` comment, and any line that is nothing but one — the fixture's answer to
/// TypeScript's type-strip.
fn strip_comments(source: &str) -> String {
    let mut out = String::with_capacity(source.len());
    for line in source.lines() {
        let code = match line.split_once('#') {
            Some((before, _)) => before.trim_end(),
            None => line,
        };
        if code.trim().is_empty() {
            continue;
        }
        out.push_str(code);
        out.push('\n');
    }
    out
}
