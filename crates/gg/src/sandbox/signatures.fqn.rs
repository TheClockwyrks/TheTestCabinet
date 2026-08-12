//! **The rule one fully-qualified name is held to** — the single scheme by which eleven languages
//! that disagree about how a name is spelled produce keys a model can type and gg can resolve.
//!
//! # It is not one spelling, and pretending otherwise would produce a key nobody can type
//!
//! A fully-qualified name is **the arm's own spelling**, emitted by that arm's reflector out of that
//! arm's own compiler or documentation tool. gg never assembles one, and could not: `gg::fs::read_file`,
//! `Gg.Files.ReadFile`, `gg.files.Files.readFile` and `GgFiles.readFile(_:offset:limit:)`
//! are four correct answers to one question, and a scheme that flattened them into a shared syntax
//! would hand a model a key its own language has no way to write.
//!
//! What is shared is not the string but **four invariants**, and this module is where three of them
//! are decided (the fourth, that opening a name resolves, is a property of the
//! [documentation runtime](crate::docs) and is asserted there):
//!
//! 1. **Module-qualified, always.** A name begins with its module's own
//!    [path](super::ModuleDoc::path), followed by a separator. `gg::fs::read_file`, never a bare
//!    `read_file`. This is what makes two arms' names comparable *as names* even where nothing else
//!    about them is, and what makes a name safe to collide on: two modules may both offer `close`.
//! 2. **Exactly three shapes.** `module ∘ function`, `module ∘ Type`, `module ∘ Type ∘ member` — in
//!    the arm's own separators, whatever those are.
//! 3. **Unique within the arm.** No two catalogued entries may claim one name, because a name is
//!    what a documentation view is keyed by and two entries under one key means one of them is
//!    unreachable.
//!
//! # How a language with no standalone functions spells a standalone function
//!
//! Java and C# have no free functions, so an operation every other arm spells as one has to be
//! spelled as a member of something. Both do it, and they do it differently, and the rule accepts
//! both because it checks *shape against the kind the arm declared* rather than against a spelling:
//!
//! * **C#** makes the module a static class, so `Gg.Files.ReadFile` is a
//!   [static method](super::EntryKind::StaticMethod) whose owning class **is** the module path. It
//!   has no [receiver](super::FunctionSignature::receiver), and its name is therefore the
//!   `module ∘ function` shape — one segment after the module, exactly like Rust's.
//! * **Java** does the same thing with the same shape: `gg.files.Files.readFile` is a
//!   [static method](super::EntryKind::StaticMethod) on the class `gg.files.Files`, whose
//!   package-and-class path **is** the module path, so it too has no receiver and takes one segment
//!   after the module. What Java adds is a second kind of entry rather than another answer to this
//!   question: a value a call hands back may carry an instance
//!   [method](super::EntryKind::Method), and that one — `gg.board.Board.IssueCreated#await`, with
//!   the receiver `IssueCreated` — is the `module ∘ Type ∘ member` shape.
//!
//! So the rule is stated once as *a receiver adds a segment*, and an arm's entries differ in
//! whether they have one rather than in what they are held to. An arm that declares a method and
//! names no receiver, or names a receiver the name does not contain, is a defect this catches.
//!
//! # Why the check parses rather than pattern-matches
//!
//! Because the separators are the arm's. `::`, `.`, `#`, `/` and combinations of them all appear
//! across the eleven, sometimes two of them in one name — `gg/agents.SubagentHandle#wait` uses three
//! — and a rule that enumerated them would be a rule that fails on the twelfth language. Instead the
//! module path is matched as a **literal prefix**, whatever it contains, and the tail is split on
//! runs of anything that cannot continue an identifier. The one thing that is treated specially is a
//! trailing **signature suffix** — Swift's argument labels `(_:offset:limit:)`, or a parameter list
//! or generic argument list on any arm that needs one to tell two entries apart — which is part of
//! the name's identity where it appears and is not a segment.

use std::collections::BTreeSet;
use std::fmt;

use super::{EntryKind, SignatureCatalogue};

/// Which of the three shapes a name is expected to have.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Shape {
    /// `module ∘ function` — one segment after the module path. A free function, and the shape a
    /// static method on the module's own class takes.
    Standalone,
    /// `module ∘ Type` — one segment after the module path, naming a declared type.
    Type,
    /// `module ∘ Type ∘ member` — two segments, the first the receiver.
    Member,
}

impl Shape {
    /// How many segments follow the module path in this shape.
    const fn segments(self) -> usize {
        match self {
            Self::Standalone | Self::Type => 1,
            Self::Member => 2,
        }
    }
}

/// One way a name fails the rule, in the words the gate reports it by.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Fault {
    /// The name does not begin with its module's path, or begins with it only by accident — as
    /// `gg::fsx::read` begins with `gg::fs` — because what follows the prefix continues an
    /// identifier rather than separating one.
    NotModuleQualified {
        /// The name as the catalogue emitted it.
        fqn: String,
        /// The module path it was expected to be qualified by.
        module: String,
    },
    /// The name has the wrong number of segments for the kind of thing it names: a member with no
    /// receiver in it, or a free function that reads as one.
    WrongShape {
        /// The name as the catalogue emitted it.
        fqn: String,
        /// The shape its declared kind requires.
        expected: Shape,
        /// The segments actually found after the module path.
        found: Vec<String>,
    },
    /// The last segment is not the name a program calls the entry by, so the key and the call do not
    /// describe the same function.
    NameMismatch {
        /// The name as the catalogue emitted it.
        fqn: String,
        /// The name a program writes.
        name: String,
    },
    /// The receiver segment is not the type the entry says it hangs off.
    ReceiverMismatch {
        /// The name as the catalogue emitted it.
        fqn: String,
        /// The receiver the entry declared.
        receiver: String,
    },
    /// A [method](EntryKind::Method) that named no receiver at all — the one shape that cannot be
    /// checked, because there is nothing to check the segment against.
    MethodWithoutReceiver {
        /// The name as the catalogue emitted it.
        fqn: String,
    },
}

impl fmt::Display for Fault {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotModuleQualified { fqn, module } => write!(
                f,
                "`{fqn}` is not qualified by its module `{module}` — every name is module-qualified, \
                 so that two modules may both offer a `close`"
            ),
            Self::WrongShape {
                fqn,
                expected,
                found,
            } => write!(
                f,
                "`{fqn}` has {} segment(s) after its module ({found:?}) where a {expected:?} name \
                 has {}",
                found.len(),
                expected.segments()
            ),
            Self::NameMismatch { fqn, name } => write!(
                f,
                "`{fqn}` does not end with `{name}`, which is the name a program calls it by"
            ),
            Self::ReceiverMismatch { fqn, receiver } => write!(
                f,
                "`{fqn}` does not name its receiver `{receiver}` before the member"
            ),
            Self::MethodWithoutReceiver { fqn } => write!(
                f,
                "`{fqn}` is declared a member function and names no receiver, so nothing says what \
                 it hangs off"
            ),
        }
    }
}

/// Hold one name to the rule: module-qualified, of the right shape for its kind, ending in the name
/// a program writes, and naming its receiver where it has one.
pub(crate) fn check(
    fqn: &str,
    module_path: &str,
    name: &str,
    receiver: Option<&str>,
    shape: Shape,
) -> Result<(), Fault> {
    let Some(tail) = tail(fqn, module_path) else {
        return Err(Fault::NotModuleQualified {
            fqn: fqn.to_string(),
            module: module_path.to_string(),
        });
    };
    let found = segments(tail);
    if found.len() != shape.segments() {
        return Err(Fault::WrongShape {
            fqn: fqn.to_string(),
            expected: shape,
            found: found.iter().map(|s| (*s).to_string()).collect(),
        });
    }
    // The last segment is the thing itself. It is compared against the name a program writes rather
    // than against anything derived, because that name is what the model has in front of it: a key
    // whose tail is not the call is a key the model cannot get to from the documentation it read.
    let last = found.last().copied().unwrap_or_default();
    if last != name {
        return Err(Fault::NameMismatch {
            fqn: fqn.to_string(),
            name: name.to_string(),
        });
    }
    if shape == Shape::Member {
        let Some(receiver) = receiver else {
            return Err(Fault::MethodWithoutReceiver {
                fqn: fqn.to_string(),
            });
        };
        if found[0] != receiver {
            return Err(Fault::ReceiverMismatch {
                fqn: fqn.to_string(),
                receiver: receiver.to_string(),
            });
        }
    }
    Ok(())
}

/// Whether `c` can continue an identifier in *some* language whose names reach this rule.
///
/// Deliberately generous — anything alphanumeric, plus `_` — because the alternative is a per-arm
/// table of identifier syntaxes, and the thing being separated is a name the arm's own compiler
/// already accepted. What matters is only that a separator is *not* one of these.
fn is_identifier(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// Where a name's trailing **signature suffix** begins — Swift's argument labels, a parameter list,
/// a generic argument list — or the end of the string.
///
/// These are part of a name's identity on the arms that emit them (`editFile(_:replacing:with:)` and
/// `editFile(_:old:new:)` are two functions in Swift and a label-stripped key could not tell them
/// apart) and they are not segments, so they are cut off before splitting rather than treated as
/// separators.
fn suffix_at(text: &str) -> usize {
    text.find(['(', '<', '[']).unwrap_or(text.len())
}

/// The part of `fqn` after its module path and the separator following it, or `None` when the module
/// path is not a prefix of it at all — or is one only by accident, as `gg::fs` is of `gg::fsx`.
fn tail<'a>(fqn: &'a str, module_path: &str) -> Option<&'a str> {
    let rest = fqn.strip_prefix(module_path)?;
    // A separator, not merely *something*: the character right after the module path has to be one
    // that cannot continue an identifier, or the prefix match was a coincidence rather than a
    // qualification.
    let separator: usize = rest
        .chars()
        .take_while(|c| !is_identifier(*c))
        .map(char::len_utf8)
        .sum();
    if separator == 0 {
        return None;
    }
    let tail = &rest[separator..];
    (!tail.is_empty()).then_some(tail)
}

/// The identifier segments of a name's tail, in order — the tail cut at its signature suffix and
/// split on runs of anything that cannot continue an identifier.
fn segments(tail: &str) -> Vec<&str> {
    tail[..suffix_at(tail)]
        .split(|c| !is_identifier(c))
        .filter(|segment| !segment.is_empty())
        .collect()
}

/// Every way `catalogue`'s names fail the rule. Empty is the passing answer.
///
/// What it holds a catalogue to, beyond the per-name rule:
///
/// * every entry's module is one the catalogue declares — a name qualified by a module nobody
///   documented is a name whose prefix means nothing;
/// * no two entries share a name, because a name is a documentation view's key;
/// * every [type reference](super::TypeReference) resolves to a type this catalogue declares, which
///   is what makes "open the types this function returns" a lookup rather than a guess;
/// * no **written spelling** — `Files.FileRead`, `files::FileRead` — names two types. The spelling
///   is the string a model reads inside a signature and copies out of it, and it is a second key the
///   lookup accepts; two declarations answering to one would make that lookup a coin toss;
/// * every declared type is **referred to by something**. A type nothing reaches is a documentation
///   view nothing can open: reachability from a bound call is what gates a type view, so an
///   unreferenced declaration is dead weight in the catalogue and an unanswerable name to the one
///   reader it exists for;
/// * every [member function](super::MemberFunction) a type lists is itself catalogued under that
///   name, so the menu a type view shows is a menu of things that can actually be opened.
pub(crate) fn faults(catalogue: &SignatureCatalogue) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut claimed: BTreeSet<&str> = BTreeSet::new();
    let path_of = |id: &str| {
        catalogue
            .modules
            .iter()
            .find(|module| module.id == id)
            .map(|module| module.path.as_str())
    };
    let declared: BTreeSet<&str> = catalogue
        .types
        .iter()
        .map(|declaration| declaration.fqn.as_str())
        .collect();
    // The two questions a reference answers, gathered as the functions are walked: which
    // declarations are reached at all, and under which written spellings a model has seen them.
    let mut reached: BTreeSet<&str> = BTreeSet::new();
    let mut spelled: BTreeSet<&str> = BTreeSet::new();

    for function in &catalogue.functions {
        // Gathered first, and before any early exit: what a signature *refers to* is a fact about
        // the reference, and a function whose module is misnamed still puts the types it names
        // within a program's reach. Folding this in after a `continue` would make one fault
        // manufacture a second, unrelated one.
        for reference in function.returns.iter().chain(&function.types) {
            reached.insert(reference.fqn());
            spelled.insert(reference.spelled());
        }
        let Some(path) = path_of(&function.module) else {
            out.push(format!(
                "`{}` is documented under the module `{}`, which the catalogue does not declare",
                function.fqn, function.module
            ));
            continue;
        };
        // A receiver is what decides the shape, not the kind: C# and Java both spell a standalone
        // function as a static method with no receiver, and on every arm a receiver is what adds the
        // extra segment. See this module's header.
        let shape = match (function.kind, function.receiver.as_deref()) {
            (EntryKind::Method, None) => {
                out.push(
                    Fault::MethodWithoutReceiver {
                        fqn: function.fqn.clone(),
                    }
                    .to_string(),
                );
                continue;
            }
            (_, Some(_)) => Shape::Member,
            (_, None) => Shape::Standalone,
        };
        if let Err(fault) = check(
            &function.fqn,
            path,
            &function.name,
            function.receiver.as_deref(),
            shape,
        ) {
            out.push(fault.to_string());
        }
        if !claimed.insert(function.fqn.as_str()) {
            out.push(format!(
                "two entries claim the name `{}`, and a name is what a documentation view is keyed \
                 by",
                function.fqn
            ));
        }
        for reference in function.returns.iter().chain(&function.types) {
            if !declared.contains(reference.fqn()) {
                out.push(format!(
                    "`{}` refers to the type `{}`, which this catalogue does not declare — a \
                     reference gg cannot resolve is a documentation view it cannot open",
                    function.fqn,
                    reference.fqn()
                ));
            }
        }
    }

    for declaration in &catalogue.types {
        let fqn = declaration.fqn.as_str();
        let module = declaration.module.as_str();
        let Some(path) = path_of(module) else {
            out.push(format!(
                "the type `{fqn}` belongs to the module `{module}`, which the catalogue does not \
                 declare"
            ));
            continue;
        };
        if let Err(fault) = check(fqn, path, &declaration.name, None, Shape::Type) {
            out.push(fault.to_string());
        }
        if !claimed.insert(fqn) {
            out.push(format!(
                "two entries claim the name `{fqn}`, and a name is what a documentation view is \
                 keyed by"
            ));
        }
        for member in &declaration.member_functions {
            if !catalogue
                .functions
                .iter()
                .any(|function| function.fqn == member.fqn)
            {
                out.push(format!(
                    "`{fqn}` lists the member function `{}`, which is not catalogued — a type view \
                     is a menu, and every entry on it has to be openable",
                    member.fqn
                ));
            }
        }
        if !reached.contains(fqn) {
            out.push(format!(
                "nothing refers to the type `{fqn}`, so no agent can reach it and no documentation \
                 view of it can be opened — a declaration only exists to be read"
            ));
        }
    }

    // One spelling, one type. A spelling that two declarations both answer to would make the lookup
    // that accepts it a coin toss: `read_any` takes the first, and the model would be shown the
    // wrong declaration under a name it read in a real signature. That the spelling resolves *at
    // all* is guaranteed by construction — it is recorded beside its own resolution — so
    // ambiguity is the only thing left here to be wrong, and the runtime gate over the whole lookup
    // lives in `docs.test.rs` where the reachability half can be asked as well.
    for spelling in spelled {
        let mut resolutions: BTreeSet<&str> = BTreeSet::new();
        for reference in catalogue
            .functions
            .iter()
            .flat_map(|function| function.returns.iter().chain(&function.types))
        {
            if reference.spelled() == spelling {
                resolutions.insert(reference.fqn());
            }
        }
        if resolutions.len() > 1 {
            out.push(format!(
                "signatures write the type `{spelling}` for {resolutions:?} — one spelling has to \
                 name one type, or the lookup that accepts it answers with whichever came first"
            ));
        }
    }

    out
}

#[cfg(test)]
#[path = "signatures.fqn.test.rs"]
mod tests;
