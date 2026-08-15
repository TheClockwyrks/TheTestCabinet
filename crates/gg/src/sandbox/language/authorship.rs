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
//! # What a byte comparison cannot see
//!
//! Three injection shapes leave the model's bytes untouched and are invisible here. They are named
//! rather than guarded against, because each is deleted in its own arm's step and a gate that
//! claimed to cover them would be worse than one that says it does not:
//!
//! * **A second compilation unit that names the model's.** A generated entry class calling into a
//!   class the model's statements were placed in, a `GlobalUsings.cs` beside the program, a shell
//!   that calls `main`. Every byte the model wrote is still there, in its own file.
//! * **An SDK in scope with no line the model wrote.** A precompiled header carrying gg's surface, an
//!   `@_exported import`, a prelude glob, a scope of names handed to an evaluator. Nothing is added
//!   to the source; the compiler is simply told the names already exist.
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
    /// **Rewrote them.** Nothing the preparation produced carries the bytes whole. A re-print, an
    /// indent, a hoisted line, a renamed declaration.
    Rewritten,
}

impl Did {
    /// The verdict as a failure message reads it.
    fn label(self) -> &'static str {
        match self {
            Self::Kept => "kept the bytes it was handed",
            Self::Wrapped => "wrapped the bytes it was handed",
            Self::Rewritten => "rewrote the bytes it was handed",
        }
    }
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
    // ---- typescript ---------------------------------------------------------------------------
    //
    // Both halves are the strip's, and the strip re-prints: what a diagnostic from the guest is
    // reported against is a printed copy of the model's tree, on its own lines, with its own
    // indentation. `tsc` reads the model's own file, so the arm's compiler diagnostics are located
    // in the model's coordinates and its runtime ones are not.
    Unconverted {
        arm: GgProgramLanguage::TypeScript,
        half: Half::Program,
        did: Did::Rewritten,
        adds: "\n\t\tmodule: path,",
        instead: "prints the parsed program back out, joining its lines and re-indenting with tabs",
    },
    Unconverted {
        arm: GgProgramLanguage::TypeScript,
        half: Half::Module,
        did: Did::Rewritten,
        adds: "return { functions };",
        instead: "prints the module back out and appends a `return` of its namespace",
    },
    // ---- javascript ---------------------------------------------------------------------------
    //
    // The same strip serves this arm, so it produces the same two texts from the same two sources.
    Unconverted {
        arm: GgProgramLanguage::JavaScript,
        half: Half::Program,
        did: Did::Rewritten,
        adds: "\n\t\tmodule: path,",
        instead: "prints the parsed program back out, joining its lines and re-indenting with tabs",
    },
    Unconverted {
        arm: GgProgramLanguage::JavaScript,
        half: Half::Module,
        did: Did::Rewritten,
        adds: "return { functions };",
        instead: "prints the module back out and appends a `return` of its namespace",
    },
    // ---- ruby -----------------------------------------------------------------------------------
    Unconverted {
        arm: GgProgramLanguage::Ruby,
        half: Half::Module,
        did: Did::Wrapped,
        adds: "GG::Lib.define do",
        instead: "opens the module inside a block whose lines the arm then subtracts from a \
                  diagnostic by arithmetic",
    },
    // ---- java -----------------------------------------------------------------------------------
    Unconverted {
        arm: GgProgramLanguage::Java,
        half: Half::Program,
        did: Did::Wrapped,
        adds: "static void ggBody() throws Throwable {",
        instead: "puts the statements in a method of a class it declares, under twenty-one imports",
    },
    Unconverted {
        arm: GgProgramLanguage::Java,
        half: Half::Module,
        did: Did::Wrapped,
        adds: "public final class Module {",
        instead: "puts the class body in a class it declares, under twenty-three imports",
    },
    // ---- kotlin ---------------------------------------------------------------------------------
    //
    // The program half keeps its bytes only because gg's own opening program writes no `import`:
    // this arm hoists a model's imports to the head of the file when it wrote any, which is the
    // conditional transform this gate's header says a byte comparison cannot see.
    Unconverted {
        arm: GgProgramLanguage::Kotlin,
        half: Half::Module,
        did: Did::Wrapped,
        adds: "@file:JvmName(\"Module\")",
        instead: "puts the file under file-level annotations and two imports of its own",
    },
    // ---- rust -----------------------------------------------------------------------------------
    Unconverted {
        arm: GgProgramLanguage::Rust,
        half: Half::Program,
        did: Did::Wrapped,
        adds: "struct __GgProgram;",
        instead: "puts the statements in a function body, under a prologue declaring the guest type \
                  and the entry point, and refuses a program that declares `main` itself",
    },
    Unconverted {
        arm: GgProgramLanguage::Rust,
        half: Half::Module,
        did: Did::Wrapped,
        adds: "use ::gg::prelude::*;",
        instead: "puts the module under a glob import of gg's prelude",
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
        did: Did::Wrapped,
        adds: "namespace lib::module {",
        instead: "puts the module in a namespace it declares, anchored by a `#line` directive",
    },
    // ---- csharp ---------------------------------------------------------------------------------
    Unconverted {
        arm: GgProgramLanguage::CSharp,
        half: Half::Module,
        did: Did::Wrapped,
        adds: "public static class Module",
        instead: "puts the module in a class it declares, anchored by a `#line` directive",
    },
    // ---- the cells that keep their bytes and are not converted ----------------------------------
    //
    // No row, because there is nothing here to record: these arms hand the compiler what they were
    // handed, and what they do besides is a shape this measurement says it cannot see.
    //
    // * C++, Swift and C# programs reach gg's surface with no line the program wrote — a
    //   precompiled header on `-include-pch`, a shell writing `@_exported import gg` behind
    //   `-import-objc-header`, a `GlobalUsings.cs` compiled beside the program.
    // * Kotlin lifts a model's `import` lines to the head of the file when it wrote any, and gg's
    //   own opening program writes none.
    // * PureScript supplies a module header when the reply has none and renames one that names
    //   something other than `Main`, and gg's own opening program writes `module Main where`.
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
                "{subject}: it keeps the bytes it was handed, and its row still records that it \
                 {records}; delete the row"
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
    let Some(verdict) = classify(&handed, &produced) else {
        return vec![Failure::Vanished {
            subject,
            produced: excerpt(&produced.join("\n---\n")),
        }];
    };
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
        (None, Did::Kept) => {}
        (Some(row), Did::Kept) => failures.push(Failure::Converted {
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
