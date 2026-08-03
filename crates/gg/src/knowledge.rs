//! **Code knowledge**: the modules an agent has loaded by reading a code
//! [skill](crate::skills) or a code [memory](crate::memories), and the on-use scripts waiting to run
//! for the ones it just read.
//!
//! A [skill](https://docs.testcabinet.ai/gg/skills/) or a memory used to be prose and nothing else.
//! Under [responses-as-code](https://docs.testcabinet.ai/gg/responses-as-code/) it may instead — or
//! as well — be **code**, in two independent halves:
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
//! Nothing here occupies a token. A loaded module is transpiled JavaScript the host holds and hands
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

use crate::sandbox::{CodeModule, TranspileError, transpile_module, transpile_program};

/// Where a piece of loaded code came from — what a failure names, and what the reply to the read
/// that loaded it calls the thing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum KnowledgeOrigin {
    /// An authored [skill](crate::skills)'s `skill.ts` / `on-use.ts`.
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
/// that already holds the [tool api](crate::sandbox::ToolApi) mutably, so there is no api to run a
/// second program against. The second is that deferring is the honest contract anyway — the views
/// the script opens arrive in the next prompt, which is what every view does.
#[derive(Debug, Clone)]
pub struct PendingOnUse {
    /// Whether it belongs to a skill or a memory.
    pub origin: KnowledgeOrigin,
    /// The skill's name or the memory's slug, for the sentence a failure produces.
    pub name: String,
    /// The transpiled script.
    pub js: String,
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
    pub fn note(&self, origin: KnowledgeOrigin) -> Option<String> {
        if self.is_empty() {
            return None;
        }
        let mut note = String::new();
        if let Some(key) = &self.key {
            note.push_str(&format!(
                "\n\n---\nThe code this {} carries is loaded: call it as `lib.{key}.<name>`",
                origin.noun()
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
    /// Both halves are transpiled **here**, at the read, and a failure in either is returned rather
    /// than stored: whoever wrote the thing gets a located diagnostic on the call that tried to use
    /// it, instead of a silent empty `lib` entry and a `TypeError` two turns later.
    ///
    /// Loading the same thing twice is idempotent — the key is re-used, the source replaced (a
    /// memory can be updated), and the on-use script is **not** queued again. "Once" means once per
    /// agent, not once per read.
    pub fn load(
        &mut self,
        origin: KnowledgeOrigin,
        name: &str,
        code: Option<&str>,
        on_use: Option<&str>,
    ) -> Result<Loaded, KnowledgeError> {
        let mut loaded = Loaded::default();
        let identity = (origin, name.to_string());
        let first_use = !self.used.contains(&identity);

        if let Some(source) = code {
            let transpiled = transpile_module(source).map_err(|error| KnowledgeError {
                origin,
                name: name.to_string(),
                half: "code",
                error,
            })?;
            let key = match self.keys.get(&identity) {
                Some(key) => key.clone(),
                None => {
                    let key = self.mint_key(name);
                    self.keys.insert(identity.clone(), key.clone());
                    key
                }
            };
            self.loaded.insert(key.clone(), transpiled.js);
            loaded.exports = transpiled.exports;
            loaded.key = Some(key);
        }

        if let Some(source) = on_use
            && first_use
        {
            let js = transpile_program(source)
                .map(|transpiled| transpiled.js)
                .map_err(|error| KnowledgeError {
                    origin,
                    name: name.to_string(),
                    half: "onUse",
                    error,
                })?;
            let module = loaded.key.as_ref().and_then(|key| {
                self.loaded.get(key).map(|source| CodeModule {
                    name: key.clone(),
                    source: source.clone(),
                })
            });
            self.pending.push(PendingOnUse {
                origin,
                name: name.to_string(),
                js,
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

    /// A `lib` key for `name` that nothing else has taken.
    fn mint_key(&self, name: &str) -> String {
        let base = camel_case(name);
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

/// A code half that would not transpile, named so the model can tell which of the two failed.
#[derive(Debug, Clone)]
pub struct KnowledgeError {
    /// Whether it was a skill's or a memory's.
    pub origin: KnowledgeOrigin,
    /// The skill's name or the memory's slug.
    pub name: String,
    /// Which half — `code` or `onUse`, spelled as the model writes it.
    pub half: &'static str,
    /// What the transpiler said, already located in the author's own coordinates.
    pub error: TranspileError,
}

impl std::fmt::Display for KnowledgeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "the `{}` of {} `{}` did not compile: {}",
            self.half,
            self.origin.noun(),
            self.name,
            self.error
        )
    }
}

/// `csv-tools` → `csvTools`, `my_helpers.v2` → `myHelpersV2`, `9lives` → `_9lives`.
///
/// The result is always a valid JavaScript identifier, because it is a property a program spells out
/// (`lib.csvTools.parse`) rather than one it looks up with a string.
fn camel_case(name: &str) -> String {
    let mut out = String::new();
    let mut capitalize = false;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            if capitalize {
                out.extend(ch.to_uppercase());
                capitalize = false;
            } else {
                out.push(ch);
            }
        } else {
            // Any separator — `-`, `_`, `.`, or anything a name should not have had — joins the next
            // word rather than surviving into an identifier that would not parse.
            capitalize = !out.is_empty();
        }
    }
    if out.is_empty() {
        return "module".to_string();
    }
    if out.starts_with(|ch: char| ch.is_ascii_digit()) {
        out.insert(0, '_');
    }
    out
}

#[cfg(test)]
#[path = "knowledge.test.rs"]
mod tests;
