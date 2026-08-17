//! **The authorship gate** — the assertion that the bytes an arm compiles are the bytes it was
//! handed.
//!
//! The [invariants](https://docs.testcabinet.ai/gg/responses-as-code/invariants/) open on it: gg
//! writes no prologue, no epilogue, no entry point and no import around a model's reply, and where a
//! language requires an entry point the model declares it. The seam states the rule
//! ([`language`](super)); this measures who keeps it.
//!
//! # What it drives, and what it reads
//!
//! Every registered arm's **program step** and **module step**, once each, with a whole program of
//! that arm's own — the [program that opens a session](super::ProgramLanguage::bootstrap_program)
//! and the [module a gate drives an arm with](super::ProgramLanguage::gate_module). Both are sources
//! gg writes on a model's behalf, and the seam requires each to be a whole program by its arm's own
//! rules, so they are the one subject that exists for eleven arms without eleven hand-written
//! programs — and an arm whose generated program is only a program because a wrapper completes it is
//! exactly what this is looking for.
//!
//! What the preparation then did to those bytes is read from the two places a preparation puts
//! them, neither of which it has to cooperate to expose:
//!
//! * every file it wrote into its own [workspace](super::compile::Workspace) — what its compiler was
//!   handed;
//! * the [source](super::PreparedProgram::source) it hands the guest, for the arms that hand one.
//!
//! Each of those is compared with the bytes the arm was given, and the verdict is the **least
//! faithful** relation any of them has to it: [`Kept`](Did::Kept) where a text is those bytes,
//! [`Wrapped`](Did::Wrapped) where a text contains them whole, [`Rewritten`](Did::Rewritten) where
//! no text does. Least faithful rather than most, because both channels are the model's program: an
//! arm that hands its compiler the model's own file and its guest a re-print of it has rewritten the
//! program the model reads its failures against.
//!
//! A rewrite the arm hands back a **source map** for is [`Mapped`](Did::Mapped) instead, and needs no
//! row. That is the invariants' own rule rather than an exemption: where types must be erased the
//! compiler emits new text, and what makes the location a failure reports the model's own is the map
//! the compiler emitted with it. [`maps_back`] is what holds a map to that claim.
//!
//! # What a byte comparison cannot see
//!
//! Three injection shapes leave the model's bytes untouched and are invisible here. They are named
//! rather than guarded against, because each is held by the arm that could commit it — a test on
//! each arm compiles a whole program that omits the import and asserts the language's own
//! diagnostic — and a gate that claimed to cover them here would be worse than one that says it does
//! not:
//!
//! * **A second compilation unit that names the model's.** A generated entry class calling into a
//!   class the model's statements were placed in, a `GlobalUsings.cs` beside the program, a shell
//!   that calls `main`. Every byte the model wrote is still there, in its own file.
//! * **A library in scope with no line the model wrote.** A precompiled header, a re-exported
//!   import, a prelude glob, a scope of names handed to an evaluator. Nothing is added to the
//!   source; the compiler is simply told the names already exist — and it is as much a violation
//!   when the names are the language's own standard library as when they are gg's SDK.
//!
//!   The shape that cost the most to delete was evaluating a program as the body of a function,
//!   which the ECMAScript arms once did: beyond the names it bought, a top-level `return` ended the
//!   program and every statement after it was dead. That is legal JavaScript, so nothing refused it
//!   and the turn was recorded as a success — the shape a model drafting two programs and pasting
//!   the second after the first lands in, kept as the `round2-*-two-drafts` fixtures in
//!   `healing.test.rs`. A module has no function body to return from, so the language reports it
//!   before anything runs.
//! * **A transform conditional on a construct the generated program does not contain.** An arm that
//!   hoists a model's `import` lines only when it wrote one keeps the bytes of a program that wrote
//!   none.
//!
//! # The table fails in both directions
//!
//! [`UNCONVERTED`] records every arm and half that does not keep its bytes today, what it does
//! instead, and one string the preparation added that the arm was not handed. It is a pin, not a
//! permission:
//!
//! * a row whose arm now keeps its bytes fails, and the gate says to delete the row;
//! * an arm with no row that stops keeping its bytes fails, because nothing records it;
//! * a row whose arm now does something *else* — wraps where it rewrote — fails, because the row
//!   names what it does.
//!
//! So an arm that converts deletes its rows rather than needing a gate of its own, and no arm can
//! hide behind another's.
//!
//! Every row here was written from what this gate **measured**. Set `GG_AUTHORSHIP_SHOW` in the
//! environment and run it with `--no-capture` to read every cell, which is how a row is written and
//! how one is checked before it is deleted.

use std::path::Path;

use test_cabinet_core::gg::GgProgramLanguage;

use super::compile::PrepareContext;
use super::{ProgramLanguage, all_languages};

/// The name the [module](ProgramLanguage::gate_module) the gate drives an arm's module step with
/// carries.
const MODULE_NAME: &str = "gg-authorship-marker";

/// The modules the [opening program](ProgramLanguage::bootstrap_program) searches and the
/// documentation keys it opens views of, resolved out of **this arm's own catalogue** exactly as
/// [`crate::bootstrap`] resolves them.
///
/// Read rather than written down, for the two reasons everything else in gg reads a spelling: an
/// arm files its calls under its own names, and a name typed here would be a second copy of one the
/// catalogue already carries. What comes back is what a run's own opening turn is generated over,
/// so what this gate prepares is the program that arm really opens a session with.
fn subject(language: &'static dyn ProgramLanguage) -> (Vec<String>, Vec<String>) {
    let functions = crate::sandbox::catalogue_functions(language);
    let mut modules: Vec<String> = Vec::new();
    let mut docs: Vec<String> = Vec::new();
    for call in crate::bootstrap::BOOTSTRAP_CALLS {
        let function = functions
            .iter()
            .find(|function| {
                function.alias_of.is_none()
                    && crate::sandbox::operation_of(function)
                        .is_some_and(|operation| operation.id == *call)
            })
            .unwrap_or_else(|| {
                panic!(
                    "{}'s catalogue carries no call for `{call:?}`, so gg could not generate its \
                     opening program either",
                    language.display_name()
                )
            });
        if !modules.iter().any(|module| module == function.object) {
            modules.push(function.object.to_string());
        }
        docs.push(function.fqn.to_string());
    }
    (modules, docs)
}

/// Which of a language's two preparation steps a measurement is of.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Half {
    /// A model's reply.
    Program,
    /// A code skill's or memory's module.
    Module,
}

impl Half {
    /// Both halves, so a row for one that no measurement drives cannot exist.
    const ALL: [Self; 2] = [Self::Program, Self::Module];

    /// The half's name, for a failure an operator reads without this file open.
    fn label(self) -> &'static str {
        match self {
            Self::Program => "program",
            Self::Module => "module",
        }
    }
}

/// What a preparation did to the bytes it was handed, ordered from the faithful to the least
/// faithful: a [`classification`](classify) reports the worst relation it found.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Did {
    /// **Kept them.** Something the preparation produced is those bytes, and the invariant holds.
    Kept,
    /// **Wrapped them.** The bytes are all there, whole and in order, inside something larger: a
    /// prologue, an entry point, a class, a module header.
    Wrapped,
    /// **Rewrote them, and handed back a map from the rewrite to them.**
    ///
    /// The one relation an arm may have to the model's bytes without a row, other than keeping them,
    /// and the invariants say why: a compiler that emits source is in the same position as one that
    /// emits an object file, and what makes the position legitimate is that the location a failure
    /// reports is resolved **through a source map**. TypeScript is the arm — `tsc` erases types by
    /// re-printing — and the map is `tsc`'s own, carried inline in the emission.
    ///
    /// It is not a weaker `Rewritten`: [`maps_back`] holds the map to naming the handed bytes as its
    /// source, byte for byte, and to resolving into them, so an arm cannot reach this verdict by
    /// emitting a map of something else.
    Mapped,
    /// **Rewrote them.** Nothing the preparation produced carries the bytes whole, and nothing maps
    /// back to them. A re-print, an indent, a hoisted line, a renamed declaration.
    Rewritten,
}

impl Did {
    /// The verdict as a failure message reads it.
    fn label(self) -> &'static str {
        match self {
            Self::Kept => "kept the bytes it was handed",
            Self::Wrapped => "wrapped the bytes it was handed",
            Self::Mapped => {
                "rewrote the bytes it was handed and handed back a source map naming them"
            }
            Self::Rewritten => "rewrote the bytes it was handed",
        }
    }

    /// Whether this relation satisfies the invariant on its own, with no row to record it.
    fn keeps_the_invariant(self) -> bool {
        matches!(self, Self::Kept | Self::Mapped)
    }
}

/// **Whether `produced` carries a source map that reads back into `handed`.**
///
/// Three things, and each of them is what stops this from being a rubber stamp:
///
/// * the map is the one the emission carries inline, read by [`locate`](crate::sandbox::locate) —
///   the same reader a run resolves a frame through, so a map this accepts is a map that works;
/// * it names exactly one source and carries that source's text, and that text is the bytes the arm
///   was handed, **byte for byte**;
/// * it has mappings, and every one of them lands inside those bytes.
///
/// An arm that emitted a map of some other text, or an empty one, fails all three.
fn maps_back(handed: &str, produced: &str) -> bool {
    let Some(map) = crate::sandbox::locate::embedded(produced) else {
        return false;
    };
    if map.get_source_count() != 1 || map.get_source_contents(0) != Some(handed) {
        return false;
    }
    let lines = handed.lines().count() as u32;
    map.get_token_count() > 0 && map.tokens().all(|token| token.get_src_line() < lines)
}

/// One arm and half that does not compile the bytes it was handed, and what it does instead.
struct Unconverted {
    /// The arm.
    arm: GgProgramLanguage,
    /// Which of its two preparation steps.
    half: Half,
    /// What the preparation does to the bytes.
    did: Did,
    /// One string the preparation **added**, asserted present in what it produced and absent from
    /// what it was handed.
    ///
    /// It is what makes a row a pin rather than a label: the day an arm's wrapper changes shape, the
    /// row is wrong and the gate says so, instead of going on describing a wrapper that has moved.
    adds: &'static str,
    /// What the arm does, in one clause, for whoever reads the failure rather than the table.
    instead: &'static str,
}

/// **Every arm and half that does not compile the bytes it was handed.**
///
/// Measured by this gate, through each arm's own preparation. A row is a defect that is *recorded*,
/// not one that is *accepted*: see the module documentation for why the gate fails when a row
/// becomes true as well as when it becomes false.
const UNCONVERTED: &[Unconverted] = &[
    // ---- ruby -----------------------------------------------------------------------------------
    Unconverted {
        arm: GgProgramLanguage::Ruby,
        half: Half::Module,
        did: Did::Wrapped,
        adds: "Module.new do ",
        instead: "opens the module inside a block that makes its body a namespace, on the author's \
                  own first line so that no diagnostic moves",
    },
    // ---- java -----------------------------------------------------------------------------------
    Unconverted {
        arm: GgProgramLanguage::Java,
        half: Half::Module,
        did: Did::Wrapped,
        adds: "public class Module { ",
        instead: "puts the class body in a class it declares, on the author's own first line so \
                  that no diagnostic moves",
    },
    // ---- kotlin ---------------------------------------------------------------------------------
    Unconverted {
        arm: GgProgramLanguage::Kotlin,
        half: Half::Module,
        did: Did::Wrapped,
        adds: "package lib.module; ",
        instead: "compiles the file into a package of gg's naming so that a program reaches it at \
                  `lib.<key>`, on the author's own first line so that no diagnostic moves",
    },
    // ---- swift ----------------------------------------------------------------------------------
    Unconverted {
        arm: GgProgramLanguage::Swift,
        half: Half::Module,
        did: Did::Rewritten,
        adds: "extension lib.module { public static func",
        instead: "moves the module's declarations into an extension and makes each of them `static`",
    },
    // ---- cpp ------------------------------------------------------------------------------------
    Unconverted {
        arm: GgProgramLanguage::Cpp,
        half: Half::Module,
        // `Rewritten` rather than `Wrapped` because the hoist MOVES a line the author wrote: an
        // `#include` at the module's top level is lifted into the global module fragment, so the
        // handed bytes are no longer present whole and in order. `Did::Rewritten` names "a hoisted
        // line" as exactly this shape. The move is the one this arm cannot avoid — `#include` is
        // textual, and one left inside `export namespace lib::<key>` would expand the header into
        // that namespace — and every moved line carries a `#line` stating where its author wrote it,
        // so no diagnostic moves with it.
        did: Did::Rewritten,
        adds: "export module lib.Module;\nexport namespace lib::module {",
        instead: "compiles the module as a named C++ module exporting a namespace it declares, \
                  under an include of gg's surface and the author's own includes hoisted beside it \
                  in the module's own global fragment, anchored by `#line` directives",
    },
    // ---- csharp ---------------------------------------------------------------------------------
    Unconverted {
        arm: GgProgramLanguage::CSharp,
        half: Half::Module,
        did: Did::Wrapped,
        adds: "public static class Module",
        instead: "puts the module in a class it declares, anchored by a `#line` directive",
    },
];

/// One way an arm failed the gate.
#[derive(Debug)]
pub(super) enum Failure {
    /// The source gg generated for this arm could not be prepared at all. Not an authorship
    /// failure: the seam requires every arm to be able to prepare what it generated, and the seam's
    /// own tests assert it, so this is reported apart from anything about bytes.
    Baseline {
        /// Which arm and half.
        subject: String,
        /// What preparing it said.
        error: String,
    },
    /// Nothing the preparation produced has any relation to the bytes it was handed, so there is
    /// nothing to classify. A preparation that compiled *something else* is a worse failure than one
    /// that wrapped, and it is reported as its own kind rather than as a rewrite.
    Vanished {
        /// Which arm and half.
        subject: String,
        /// What it produced, capped.
        produced: String,
    },
    /// It keeps its bytes and a row still records it as not doing so.
    Converted {
        /// Which arm and half.
        subject: String,
        /// What the row says it does instead.
        records: &'static str,
    },
    /// It does not keep its bytes and no row records it.
    Unrecorded {
        /// Which arm and half.
        subject: String,
        /// What it did instead.
        did: Did,
        /// What it produced, capped.
        produced: String,
    },
    /// It does not keep its bytes and its row records something else.
    Changed {
        /// Which arm and half.
        subject: String,
        /// What the row says it does instead.
        records: &'static str,
        /// What the row records.
        recorded: Did,
        /// What was measured.
        measured: Did,
        /// What it produced, capped.
        produced: String,
    },
    /// The row's added string is not in what the preparation produced any more.
    Stale {
        /// Which arm and half.
        subject: String,
        /// What the row says it does instead.
        records: &'static str,
        /// The string the row records as added.
        adds: &'static str,
        /// What it produced, capped.
        produced: String,
    },
    /// The row's added string is in the source the arm was **handed**, so the row asserts nothing
    /// about what the preparation added.
    Vacuous {
        /// Which arm and half.
        subject: String,
        /// The string the row records as added.
        adds: &'static str,
    },
}

impl std::fmt::Display for Failure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Baseline { subject, error } => write!(
                formatter,
                "{subject}: gg's own source for this arm could not be prepared: {error}"
            ),
            Self::Vanished { subject, produced } => write!(
                formatter,
                "{subject}: nothing it produced carries any part of the source it was handed — it \
                 produced:\n{produced}"
            ),
            Self::Converted { subject, records } => write!(
                formatter,
                "{subject}: it keeps the invariant, and its row still records that it {records}; \
                 delete the row"
            ),
            Self::Unrecorded {
                subject,
                did,
                produced,
            } => write!(
                formatter,
                "{subject}: it {}, and no row in `UNCONVERTED` records it — it produced:\n{produced}",
                did.label()
            ),
            Self::Changed {
                subject,
                records,
                recorded,
                measured,
                produced,
            } => write!(
                formatter,
                "{subject}: its row records that it {} ({records}), and it {} — it \
                 produced:\n{produced}",
                recorded.label(),
                measured.label()
            ),
            Self::Stale {
                subject,
                records,
                adds,
                produced,
            } => write!(
                formatter,
                "{subject}: its row records that it {records} by adding {adds:?}, and it no longer \
                 adds it — it produced:\n{produced}"
            ),
            Self::Vacuous { subject, adds } => write!(
                formatter,
                "{subject}: its row records {adds:?} as added, and the source it was handed already \
                 carries it, so the row asserts nothing"
            ),
        }
    }
}

/// **Drive every registered arm's two preparation steps and report every way one failed the gate.**
pub(super) fn audit() -> Vec<Failure> {
    let mut failures = Vec::new();
    for language in all_languages() {
        for half in Half::ALL {
            failures.extend(measure(language, half));
        }
    }
    failures
}

/// One arm's one half: prepare it, classify what came back, and hold it against the table.
fn measure(language: &'static dyn ProgramLanguage, half: Half) -> Vec<Failure> {
    let subject = format!("{} {}", language.display_name(), half.label());
    let handed = handed(language, half);
    let context = PrepareContext::new();
    let produced = match produced(language, half, &handed, &context) {
        Ok(produced) => produced,
        Err(error) => return vec![Failure::Baseline { subject, error }],
    };
    let Some(mut verdict) = classify(&handed, &produced) else {
        return vec![Failure::Vanished {
            subject,
            produced: excerpt(&produced.join("\n---\n")),
        }];
    };
    // A rewrite the arm can read back is a different relation from one it cannot, and the invariants
    // say so: a location may be resolved through a source map and by no other means. Asked here
    // rather than inside `classify`, because it is a question about the artifact the guest is handed
    // rather than about how any one text relates to the source.
    if verdict.did == Did::Rewritten && maps_back(&handed, &verdict.text) {
        verdict.did = Did::Mapped;
    }
    if std::env::var_os("GG_AUTHORSHIP_SHOW").is_some() {
        eprintln!(
            "=== {subject}: {} ===\nhanded:\n{}\nproduced:\n{}",
            verdict.did.label(),
            excerpt(&handed),
            excerpt(&verdict.text)
        );
    }

    let row = UNCONVERTED
        .iter()
        .find(|row| row.arm == language.id() && row.half == half);
    let mut failures = Vec::new();
    match (row, verdict.did) {
        (None, did) if did.keeps_the_invariant() => {}
        (Some(row), did) if did.keeps_the_invariant() => failures.push(Failure::Converted {
            subject,
            records: row.instead,
        }),
        (None, did) => failures.push(Failure::Unrecorded {
            subject,
            did,
            produced: excerpt(&verdict.text),
        }),
        (Some(row), did) => {
            if row.did != did {
                failures.push(Failure::Changed {
                    subject: subject.clone(),
                    records: row.instead,
                    recorded: row.did,
                    measured: did,
                    produced: excerpt(&verdict.text),
                });
            }
            if handed.contains(row.adds) {
                failures.push(Failure::Vacuous {
                    subject: subject.clone(),
                    adds: row.adds,
                });
            } else if !verdict.text.contains(row.adds) {
                failures.push(Failure::Stale {
                    subject,
                    records: row.instead,
                    adds: row.adds,
                    produced: excerpt(&verdict.text),
                });
            }
        }
    }
    failures
}

/// The whole program of this arm's own that the gate hands its `half`.
fn handed(language: &'static dyn ProgramLanguage, half: Half) -> String {
    match half {
        Half::Program => {
            let (modules, docs) = subject(language);
            language.bootstrap_program(
                &modules.iter().map(String::as_str).collect::<Vec<_>>(),
                &docs.iter().map(String::as_str).collect::<Vec<_>>(),
            )
        }
        Half::Module => language.gate_module(MODULE_NAME),
    }
}

/// Everything the preparation produced from `handed`, as text: whatever it wrote for its own
/// toolchain, and whatever it handed the guest.
///
/// The workspace is read **after** the preparation returns and while `context` is still alive, which
/// is the only window there is: the tree is removed when the context drops.
fn produced(
    language: &'static dyn ProgramLanguage,
    half: Half,
    handed: &str,
    context: &PrepareContext,
) -> Result<Vec<String>, String> {
    let prepared = match half {
        Half::Program => language
            .prepare_program(handed, &[], context)
            .map(|prepared| prepared.source),
        Half::Module => language
            .prepare_module(handed, context)
            .map(|prepared| prepared.source),
    }
    .map_err(|failure| failure.to_string())?;

    let mut produced = Vec::new();
    if !prepared.is_empty() {
        produced.push(prepared);
    }
    if let Some(root) = context.opened_workspace() {
        collect(&root.join("work"), &mut produced);
    }
    Ok(produced)
}

/// Every readable text file under `directory`, recursively.
///
/// Anything that is not UTF-8 is skipped, because a byte comparison against a source has nothing to
/// say about an object file, and so is anything above [`MAX_FILE`], because a compiler's own bundled
/// output is not what a preparation did to a model's program.
fn collect(directory: &Path, produced: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect(&path, produced);
        } else if entry.metadata().is_ok_and(|meta| meta.len() <= MAX_FILE)
            && let Ok(text) = std::fs::read_to_string(&path)
        {
            produced.push(text);
        }
    }
}

/// The largest workspace file the gate reads.
const MAX_FILE: u64 = 4 * 1024 * 1024;

/// What one arm's preparation did, and the text that decided it.
pub(super) struct Verdict {
    /// The relation the text has to the bytes the arm was handed.
    pub(super) did: Did,
    /// The text the verdict was read off.
    pub(super) text: String,
}

/// **What `produced` did to `handed`**, or `None` when nothing in it is a version of `handed` at
/// all.
///
/// The verdict is the **least faithful** relation any text that is a
/// [version of the source](is_version_of) has: an arm that hands its compiler the model's own bytes
/// and its guest a re-print of them has rewritten the program.
pub(super) fn classify(handed: &str, produced: &[String]) -> Option<Verdict> {
    let core = handed.trim_end_matches('\n');
    let mut verdict: Option<Verdict> = None;
    for text in produced {
        let did = if text.trim_end_matches('\n') == core {
            Did::Kept
        } else if text.contains(core) {
            Did::Wrapped
        } else if is_version_of(core, text) {
            Did::Rewritten
        } else {
            continue;
        };
        if verdict.as_ref().is_none_or(|worst| did > worst.did) {
            verdict = Some(Verdict {
                did,
                text: text.clone(),
            });
        }
    }
    verdict
}

/// **Whether `text` is a version of `source`** — a rewrite of the model's program rather than a
/// different file that happens to be in the same workspace.
///
/// It is: half of `source`'s own lines are in it, whole. A workspace holds an arm's SDK, its
/// libraries' sources and its compiler's output beside the program, and every one of those shares
/// braces, keywords and the odd `import Prelude` with every program ever written — so a rule that
/// asked for *one* shared line would report a library module as the model's program and pin a row
/// to it. Half is a bound a rewrite clears and a neighbour does not: a re-print moves quotes and
/// indentation and joins lines, and still leaves most statements as they were written.
///
/// Only lines long enough to belong to this source are counted, so a closing brace is nobody's
/// evidence. A source with no such line — a one-liner module — is counted on all of its non-empty
/// lines instead, rather than being a source no text can be a version of.
fn is_version_of(source: &str, text: &str) -> bool {
    let lines = |least: usize| -> Vec<&str> {
        source
            .lines()
            .map(str::trim)
            .filter(|line| line.chars().count() >= least)
            .collect()
    };
    let mut own = lines(DISTINCT_LINE);
    if own.is_empty() {
        own = lines(1);
    }
    let shared = own.iter().filter(|line| text.contains(**line)).count();
    !own.is_empty() && shared * 2 >= own.len()
}

/// How long a line must be before carrying it says anything about whose program a text is. Short
/// enough that a one-call program has such a line, long enough that punctuation and a keyword are
/// not one.
const DISTINCT_LINE: usize = 12;

/// Enough of a text to recognise it in a failure, and no more. A prepared artifact runs to hundreds
/// of kilobytes and a test failure is read in a terminal.
fn excerpt(text: &str) -> String {
    const LIMIT: usize = 600;
    let mut end = text.len().min(LIMIT);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    match end == text.len() {
        true => text.to_string(),
        false => format!("{}…", &text[..end]),
    }
}

#[cfg(test)]
#[path = "authorship.test.rs"]
mod tests;
