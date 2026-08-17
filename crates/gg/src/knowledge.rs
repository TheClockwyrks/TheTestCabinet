//! **Code knowledge**: the modules an agent has loaded by reading a code
//! [skill](crate::skills) or a code [memory](crate::memories), and the on-use scripts waiting to run
//! for the ones it just read.
//!
//! A [skill](https://docs.testcabinet.ai/gg/skills/) or a memory is prose. Under
//! [responses-as-code](https://docs.testcabinet.ai/gg/responses-as-code/api-surface/) it may instead, or as
//! well, be **code**, in two independent halves:
//!
//! - a **module**, whose exports are bound at `lib.<key>` in every program the agent writes from
//!   then on, so a helper an author got right once, or a model got right twenty turns ago, is
//!   reached by calling it rather than by rewriting it; and
//! - an **on-use script**, run once when the thing is first read, whose
//!   [views](crate::context::ViewKind) arrive in the agent's next prompt. Its source is never shown
//!   to the model: it is how a skill *shows* the agent something, not something the agent reads.
//!
//! This is the per-agent state behind both.
//!
//! # It is not a [module](crate::modules) in gg's sense
//!
//! Nothing here occupies a token. A loaded module is prepared source the host holds and hands
//! to the guest; it is never a context item, never summarized, never evicted, and a
//! [compaction](crate::compaction) boundary does not touch it. That is deliberate and it is the
//! answer to the obvious question — *does a compaction make me re-read my skills to get my helpers
//! back?* No. What a compaction sweeps is what the window holds; code is a capability the agent
//! acquired, and re-acquiring it would be friction with nothing on the other side of it.
//!
//! # It belongs to one agent instance
//!
//! A [fork](https://docs.testcabinet.ai/gg/fork-and-exec/) or a successor inherits the window and
//! the skills read set, but **not** the loaded modules: the registry is built where the session is
//! driven, and a new instance starts with nothing bound. Reading the skill again is what reloads it,
//! and a repeat read is answered with the same note naming the same key — so the recovery is one
//! call and the model is told what it got.
//!
//! # Keys
//!
//! A skill named `csv-tools` and a memory slugged `csv_tools` both want to be `lib.csvTools`. The
//! first one read gets it; the second gets `csvTools2`. Which is why **the key an agent really got
//! is stated back to it** in the reply to the read that loaded it — a binding path a model has to
//! guess is a binding path it will guess wrong.

use std::collections::{BTreeMap, BTreeSet};
use std::time::{Duration, Instant};

use crate::sandbox::{
    CodeModule, PrepareFailure, PreparedProgram, ProgramLanguage, SandboxOutcome, prepare_module,
    prepare_program,
};

/// Where a piece of loaded code came from — what a failure names, and what the reply to the read
/// that loaded it calls the thing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum KnowledgeOrigin {
    /// An authored [skill](crate::skills)'s module / on-use script, in whichever spelling this
    /// agent's language reads (`skill.ts`, `skill.py`).
    Skill,
    /// A [memory](crate::memories) the model wrote, with `code` / `onUse`.
    Memory,
}

impl KnowledgeOrigin {
    /// The word this origin is called in a message to the model.
    pub fn noun(self) -> &'static str {
        match self {
            Self::Skill => "skill",
            Self::Memory => "memory",
        }
    }
}

/// An on-use script that has not run yet.
///
/// Queued when the read happens and drained once the turn's program has ended — never run inline.
/// Two reasons, and the first alone is decisive: a read reaches gg from *inside* a membrane call
/// that already holds the [operation api](crate::sandbox::OperationApi) mutably, so there is no api
/// to run a second program against. The second is that deferring is the honest contract anyway — the
/// views the script opens arrive in the next prompt, which is what every view does.
#[derive(Debug, Clone)]
pub struct PendingOnUse {
    /// Whether it belongs to a skill or a memory.
    pub origin: KnowledgeOrigin,
    /// The skill's name or the memory's slug, for the sentence a failure produces.
    pub name: String,
    /// The prepared script — already through its language's
    /// [prepare step](crate::sandbox::ProgramLanguage::prepare_program), which is why it is a whole
    /// [`PreparedProgram`] and not the text it was written as.
    ///
    /// It is prepared **once**, here at the read, and run as-is. Preparing it again at the point of
    /// running would be a second trip through a compiler on every arm that has one, and on a
    /// compiled arm it would not even be the same program: a Rust script's prepared form is a wasm
    /// component and its source is empty, so a second preparation would compile nothing and report
    /// a clean run over a script that never executed.
    pub program: PreparedProgram,
    /// The one module bound into its scope: the same thing's own code, if it carries any. An on-use
    /// script sees its own module and no other — it runs at a moment the agent did not choose, so
    /// letting it reach whatever else happened to be loaded would make its behaviour depend on the
    /// order the agent read things in.
    pub module: Option<CodeModule>,
}

/// One agent's loaded code, and the on-use scripts it owes.
///
/// Forked with the agent (each gets its own set: what one agent has read says nothing about what
/// another has), and never shared — two agents' `lib` objects are two different sets of bindings
/// even when they came from the same skill.
#[derive(Debug, Default)]
pub struct KnowledgeModules {
    /// The loaded modules, keyed by the binding key, kept in key order so the list handed to the
    /// guest is stable from turn to turn. Stability matters more than it looks: the modules are
    /// evaluated in list order, and a set that reordered itself between turns would make a
    /// program's behaviour depend on nothing the model can see.
    loaded: BTreeMap<String, String>,
    /// Which `(origin, name)` already has a binding key, so a second read of the same skill re-uses
    /// it rather than minting `csvTools2` for the same code.
    keys: BTreeMap<(KnowledgeOrigin, String), String>,
    /// Every `(origin, name)` this agent has already brought into use, whether or not it carried any
    /// code. It is what makes an on-use script run **once per agent** rather than once per read —
    /// including for a thing that had no script the first time and has one now.
    used: BTreeSet<(KnowledgeOrigin, String)>,
    /// The on-use scripts queued this turn.
    pending: Vec<PendingOnUse>,
    /// What the language has spent **compiling for this agent** since the figure was last drained —
    /// the prepare step of every code half [`load`](Self::load) has taken, for a language that
    /// declares it [compiles](ProgramLanguage::prepare_compiles).
    ///
    /// It accumulates here rather than being returned by `load` because a load happens *inside* a
    /// membrane call, where there is no outcome to put it on: the program that caused it is still
    /// running. The [loop](crate::agent) drains it with [`take_compile`](Self::take_compile) once
    /// that program has ended and charges the program for it, which is the honest attribution —
    /// nothing prepares a module except a program that asked for one.
    ///
    /// `None` for a language whose prepare step is free, for the same reason
    /// [`SandboxOutcome::compile`](crate::sandbox::SandboxOutcome::compile) is: a sub-millisecond
    /// zero on every read is noise, and "did not compile" and "compiled instantly" are different
    /// claims.
    compiled: Option<Duration>,
}

/// What loading a code skill or memory produced — the binding key its code got, and whether an
/// on-use script was queued. Both halves are optional: a skill may carry either, both, or neither.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Loaded {
    /// The `lib` key the module was bound at, when there was a module.
    pub key: Option<String>,
    /// The names it exports, in the order the generated namespace lists them.
    pub exports: Vec<String>,
    /// Whether an on-use script was queued to run once this turn's program has ended.
    pub on_use: bool,
}

impl Loaded {
    /// Whether loading did anything at all — `false` for the ordinary prose skill or memory, whose
    /// read is exactly what it always was.
    pub fn is_empty(&self) -> bool {
        self.key.is_none() && !self.on_use
    }

    /// The sentence appended to the read's reply, telling the model where its code went.
    ///
    /// It is appended rather than returned separately because the read's result *is* the body: one
    /// string crosses the membrane, and a binding path the model has to infer is a binding path it
    /// will get wrong. An empty [`Loaded`] appends nothing, so a prose skill's reply is untouched.
    ///
    /// The call is written in the **reader's own** [spelling](ProgramLanguage::lib_access), for the
    /// same reason every call gg quotes back at a model is spelled in that model's language: on an
    /// arm where an API object is a module, `lib.<key>.<name>` is not a path the compiler will
    /// accept, and on the three that reach a module by string it is not a path at all — a binding
    /// quoted in a syntax the model cannot use is a binding it has not been given.
    ///
    /// This note is the **only** place a model is told the spelling, and on an arm that reaches a
    /// code module through its own module system it is the only place it is told the
    /// [line](ProgramLanguage::lib_import) that makes the spelling resolve. `lib` binds no
    /// catalogued function, so there is nothing to search for, and the system prompt says a skill
    /// *carries* code without saying how it is reached, because the read that binds it is the moment
    /// that answer matters.
    pub fn note(
        &self,
        origin: KnowledgeOrigin,
        language: &'static dyn ProgramLanguage,
    ) -> Option<String> {
        if self.is_empty() {
            return None;
        }
        let mut note = String::new();
        if let Some(key) = &self.key {
            note.push_str(&format!(
                "\n\n---\nThe code this {} carries is loaded: {}call it as `{}`",
                origin.noun(),
                match language.lib_import(key) {
                    Some(line) => format!("write `{line}` and "),
                    None => String::new(),
                },
                language.lib_access(key)
            ));
            if self.exports.is_empty() {
                note.push_str(". It exports nothing.");
            } else {
                note.push_str(&format!(". It exports: {}.", self.exports.join(", ")));
            }
            note.push_str(
                " It stays bound for the rest of your session, including across a compaction.",
            );
        }
        if self.on_use {
            if note.is_empty() {
                note.push_str("\n\n---");
            } else {
                note.push(' ');
            }
            note.push_str(&format!(
                "This {} also runs a script when it is first used; it runs once your program has \
                 ended, so anything it shows you arrives on your next turn.",
                origin.noun()
            ));
        }
        Some(note)
    }
}

impl KnowledgeModules {
    /// An agent with nothing loaded.
    pub fn new() -> Self {
        Self::default()
    }

    /// The modules the guest binds, in key order.
    pub fn code_modules(&self) -> Vec<CodeModule> {
        self.loaded
            .iter()
            .map(|(name, source)| CodeModule {
                name: name.clone(),
                source: source.clone(),
            })
            .collect()
    }

    /// Load the code halves of a skill or a memory that has just come into use.
    ///
    /// Both halves are prepared **here**, at the read, in the agent's own
    /// [program language](ProgramLanguage) — and a failure in either is returned rather than
    /// stored: whoever wrote the thing gets a located diagnostic on the call that tried to use it,
    /// instead of a silent empty `lib` entry and a `TypeError` two turns later.
    ///
    /// Loading the same thing twice is idempotent — the key is re-used, the source replaced (a
    /// memory can be updated), and the on-use script is **not** queued again. "Once" means once per
    /// agent, not once per read.
    ///
    /// Both preparations are **timed** for a language that
    /// [compiles](ProgramLanguage::prepare_compiles), and the reading is accumulated on
    /// [`compiled`](Self::compiled) for the loop to charge to the program that read the thing. A
    /// code skill whose module is recompiled on every agent that reads it is a real per-run cost,
    /// and it is one no other clock in gg is running for: this happens inside a membrane call, after
    /// the sandbox has taken its own reading and while the turn's own clock is stopped in a bridged
    /// call.
    ///
    /// # A code half is prepared in the **reader's** language
    ///
    /// `language` is the language of the agent doing the reading, because that is the language the
    /// module has to be evaluable in: `lib.<key>` is bound into *its* programs. Nothing records the
    /// language the code was written in — a skill is a workspace file and a memory is authored by
    /// whichever agent held it, and neither carries a language today.
    ///
    /// That is exactly right while a run is single-language, and it is a known gap the day one is
    /// not: a reviewer in one language reading a code memory a root wrote in another gets that
    /// language's syntax diagnostic appended to the read, and `lib.<key>` binds nothing. The failure
    /// is loud (the model is told, in the reply that names the key) rather than silent, which is why
    /// it is a gap rather than a defect — but closing it means recording the authoring language on
    /// the memory and on the skill and deciding what a cross-language read *should* do, which is a
    /// contract change rather than a rename.
    pub fn load(
        &mut self,
        language: &'static dyn ProgramLanguage,
        origin: KnowledgeOrigin,
        name: &str,
        code: Option<&str>,
        on_use: Option<&str>,
    ) -> Result<Loaded, KnowledgeError> {
        let mut loaded = Loaded::default();
        let identity = (origin, name.to_string());
        let first_use = !self.used.contains(&identity);

        if let Some(source) = code {
            let prepared = self
                .timed(language, || prepare_module(language, source))
                .map_err(|error| KnowledgeError {
                    origin,
                    name: name.to_string(),
                    half: "code",
                    error,
                })?;
            let key = match self.keys.get(&identity) {
                Some(key) => key.clone(),
                None => {
                    let key = self.mint_key(language, name);
                    self.keys.insert(identity.clone(), key.clone());
                    key
                }
            };
            self.loaded.insert(key.clone(), prepared.source);
            loaded.exports = prepared.exports;
            loaded.key = Some(key);
        }

        if let Some(source) = on_use
            && first_use
        {
            // The module is resolved **before** the script is prepared, not after, because a
            // compiled language links the modules in scope into the artifact it produces: a script
            // prepared without its own module in hand would be a script whose `lib` binding is
            // missing on exactly the arms where it cannot be added later.
            let module = loaded.key.as_ref().and_then(|key| {
                self.loaded.get(key).map(|source| CodeModule {
                    name: key.clone(),
                    source: source.clone(),
                })
            });
            let modules: Vec<CodeModule> = module.iter().cloned().collect();
            let script = self
                .timed(language, || prepare_program(language, source, &modules))
                .map_err(|error| KnowledgeError {
                    origin,
                    name: name.to_string(),
                    half: "onUse",
                    error,
                })?;
            self.pending.push(PendingOnUse {
                origin,
                name: name.to_string(),
                program: script,
                module,
            });
            loaded.on_use = true;
        }

        // Recorded even for a thing that carried neither half, so a memory the model later gives an
        // on-use script to does not get to run it in an agent that has already used the memory.
        self.used.insert(identity);
        Ok(loaded)
    }

    /// Every on-use script queued since the last drain, in queue order. The loop calls this once its
    /// turn's program has ended.
    pub fn take_pending(&mut self) -> Vec<PendingOnUse> {
        std::mem::take(&mut self.pending)
    }

    /// What the language has spent compiling for this agent since the last drain, and zero it.
    ///
    /// Drained by the [loop](crate::agent) after each of its programs, so the figure lands on the
    /// program that caused the load rather than on whichever one happens to run next. `None` both
    /// for a language that does not compile and for a program that loaded nothing — in the second
    /// case there is nothing to add, and adding a zero would say a compile happened.
    pub fn take_compile(&mut self) -> Option<Duration> {
        self.compiled.take()
    }

    /// Run one of the language's prepare steps, charging what it cost to
    /// [`compiled`](Self::compiled) when this language compiles.
    ///
    /// The clock is read around both outcomes: a module the compiler *rejected* cost whatever it
    /// spent rejecting it, and it is the reading that would otherwise be lost — the error path
    /// returns before anything else could take one.
    fn timed<T>(
        &mut self,
        language: &'static dyn ProgramLanguage,
        prepare: impl FnOnce() -> Result<T, PrepareFailure>,
    ) -> Result<T, PrepareFailure> {
        if !language.prepare_compiles() {
            return prepare();
        }
        let started = Instant::now();
        let prepared = prepare();
        self.compiled = SandboxOutcome::summed_compile(self.compiled, Some(started.elapsed()));
        prepared
    }

    /// A `lib` key for `name` that nothing else has taken, spelled the way `language` spells an
    /// identifier.
    fn mint_key(&self, language: &'static dyn ProgramLanguage, name: &str) -> String {
        let base = language.binding_name(name);
        if !self.loaded.contains_key(&base) {
            return base;
        }
        // `csvTools`, `csvTools2`, `csvTools3` — the suffix starts at 2 because the unsuffixed key
        // *is* the first one.
        (2..)
            .map(|n| format!("{base}{n}"))
            .find(|candidate| !self.loaded.contains_key(candidate))
            .unwrap_or(base)
    }
}

/// A code half that would not prepare, named so the model can tell which of the two failed.
#[derive(Debug, Clone)]
pub struct KnowledgeError {
    /// Whether it was a skill's or a memory's.
    pub origin: KnowledgeOrigin,
    /// The skill's name or the memory's slug.
    pub name: String,
    /// Which half — `code` or `onUse`, spelled as the model writes it.
    pub half: &'static str,
    /// Why the language's prepare step did not hand back a namespace: the author's own source, with
    /// a diagnostic located in its coordinates, or the compiler that was supposed to read it failing
    /// to run at all.
    pub error: PrepareFailure,
}

impl KnowledgeError {
    /// Whether the **author's source** is what failed, rather than something on gg's side of the
    /// seam that never judged it.
    ///
    /// The bit every reader of this error branches on, and it is asked this way round on purpose:
    /// only a source that was read and rejected has a diagnostic the caller can act on. A compiler
    /// that fell over and a [lowering](PrepareFailure::Lowering) that could not carry an accepted
    /// source any further both judged nothing — so there is nothing to show, nothing about the
    /// author's source was rejected, and whatever the failure is charged to must not be charged to
    /// whoever made the call.
    pub fn is_authors_source(&self) -> bool {
        matches!(self.error, PrepareFailure::Program(_))
    }

    /// What the run's **operator** is told about this failure, or `None` when there is nothing to
    /// tell them that the model was not already given.
    ///
    /// A [toolchain failure](PrepareFailure::Toolchain) carries the exit status, the signal, the
    /// tail of the compiler's stderr — real diagnostic value for the person who can fix the image,
    /// and nothing the model can act on, which is why [`Display`](std::fmt::Display) does not carry
    /// it. A [lowering failure](PrepareFailure::Lowering) carries gg's own diagnostic, which has the
    /// same single reader for a stronger reason: it is a bug report about gg. Without this, either
    /// detail would have no reader at all — the model must not see it, so if the operator does not
    /// either, a compiler crashing in an agent's skill load is silent everywhere.
    ///
    /// It is also what the run's [fault latch](crate::fault) is raised with, since both failures end
    /// the run: the sentence that explains the run's ending and the sentence on the operator's
    /// stream are the same sentence rather than two accounts of one event.
    pub fn operator_detail(&self) -> Option<String> {
        match &self.error {
            PrepareFailure::Program(_) => None,
            PrepareFailure::Toolchain(detail) => Some(format!(
                "the `{}` of {} `{}` was not compiled: {detail}",
                self.half,
                self.origin.noun(),
                self.name,
            )),
            PrepareFailure::Lowering(detail) => Some(format!(
                "the `{}` of {} `{}` was accepted and then could not be prepared, which is a gg \
                 defect: {detail}",
                self.half,
                self.origin.noun(),
                self.name,
            )),
        }
    }
}

impl std::fmt::Display for KnowledgeError {
    /// **What the model reads.**
    ///
    /// A compiler that could not *finish* is said differently from a source it read and rejected —
    /// "did not compile" over the second is a diagnosis, and over the first it is a guess, made
    /// about a file nothing ever judged. So the second hands back the diagnostic and the first hands
    /// back no diagnostic at all, because there is none: it says the compiler could not run, says
    /// outright that nothing about the source was rejected (the one thing a model reading a failed
    /// load will otherwise assume), and keeps the compiler's own crash detail for
    /// [the operator](Self::operator_detail).
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let (verb, error) = match &self.error {
            PrepareFailure::Program(error) => ("did not compile", error.to_string()),
            PrepareFailure::Toolchain(_) => (
                "was not compiled",
                "this language's compiler could not finish, which is a fault in the run's \
                 environment rather than in the source. Nothing about it was rejected."
                    .to_string(),
            ),
            // Said the same way and for the same reason: the source was read and accepted, and what
            // failed afterwards is gg's. Handing the model gg's own diagnostic here would be the
            // misattribution the `Compiler error` band was cured of one seam over.
            PrepareFailure::Lowering(_) => (
                "was not compiled",
                "the harness accepted it and could not prepare it, which is a defect in the \
                 harness rather than in the source. Nothing about it was rejected."
                    .to_string(),
            ),
        };
        write!(
            f,
            "the `{}` of {} `{}` {verb}: {error}",
            self.half,
            self.origin.noun(),
            self.name,
        )
    }
}

#[cfg(test)]
#[path = "knowledge.test.rs"]
mod tests;
