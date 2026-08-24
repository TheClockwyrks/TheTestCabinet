//! **The cross-arm capability gate** — the assertion that every
//! [registered language](super::all_languages) lets a model do the *same set of things*, under the
//! *same conditions*, documented to the *same standard*.
//!
//! # Why it is load-bearing
//!
//! The [responses-as-code](test_cabinet_core::gg::CAPABILITY_RESPONSES_AS_CODE) capability exists to
//! **measure**. The question that made the program language a variable at all — *does the language a
//! model writes in change how well it works?* — is answered by running two arms and comparing them,
//! and that comparison is only a measurement of the language if both arms let the model do the same
//! things. If one language's SDK were missing `files.edit_file`, or offered `views.open_file` to an
//! agent that was never granted a read, then every difference the study measured would be confounded
//! by a difference in *capability*, and the study would quietly be measuring something nobody asked
//! about.
//!
//! Nothing else in gg would notice. Each language's own gates compare it to its own prebuilt
//! component and to its own SDK — never to gg's vocabulary, and never to another language — so
//! eleven internally
//! consistent surfaces that offer eleven different sets of capabilities are eleven green test
//! suites.
//!
//! # What this gate used to be, and why that premise is gone
//!
//! It used to rest on a five-part identity tuple — section, object, key, gate, ending — and on the
//! claim that two arms "offer the same functions on the same objects under the same gates, and
//! differ only in what a program calls them". Every arm filed its calls into the same five sections,
//! hung each off the same API object, and wrote down the same gate; the gate compared one arm's
//! tuples to a reference arm's, and required them to be equal as sets.
//!
//! **That premise was retired deliberately.** API objects are a hidden vocabulary — to reach
//! anything you had to already know the object existed — and abolishing them was the point of the
//! [module surface](crate::sandbox::signatures::ModuleDoc). What replaced them are eleven
//! *idiomatic* SDKs, and idiomatic SDKs differ in **structure**: a capability is a free function on
//! one arm and a method on the type it operates on next door, one arm offers it twice under two
//! names and another once, and no two arms group their modules identically. Comparing tuples would
//! now reject every one of those, which would mean forbidding an arm from being idiomatic — itself a
//! confound, and the larger one.
//!
//! So there is **no reference arm and no comparison between arms anywhere in this file**, and
//! nothing here counts functions. What each arm is held to is gg's own
//! [operations table](crate::sandbox::operations), one arm at a time.
//!
//! # What is checked
//!
//! **Gating, over the table alone** ([`gating`]). Every row has an identity of its own under a real
//! family; the ending operations are gg's three under the roles [`EndingRole::tools`] gives them; a
//! view is gated exactly where it reads the workspace; the documentation search is bound to every
//! program and the two documentation closes are bought; every [`Binding::Capability`] names a real
//! gg capability and one gg paired with that operation's family, and the
//! [program library](crate::programs) is bought entire. This runs once rather than eleven times, and
//! it is *stronger* than the per-arm version it replaces: gating is stated in one place, so an arm
//! has no field left to be wrong in.
//!
//! What it deliberately does **not** check is any correspondence with gg's *tool* vocabulary. Tool
//! calling and responses-as-code are two surfaces over one core and an agent has exactly one of
//! them; a rule holding the two name sets in bijection would be asserting a symmetry gg does not
//! have — responses-as-code is the strictly richer surface — and it would make a tool added for a
//! tool-calling agent fail an operations table that has nothing to do with it.
//!
//! **Capability coverage, per arm** ([`coverage`]). Every operation gg offers has exactly one
//! canonical binding on every arm that is not excused; every operation an arm names is one gg has;
//! every alias names an operation that arm canonically binds. A binding is identified by
//! `(module, kind, receiver, name)` — the arm's own shape — and that identity is used to *name* a
//! binding in a complaint and to notice two of them, never to require that two arms chose the same
//! one.
//!
//! **The propagation rule** ([`Applicability`]). A helper added to one SDK is added to every other
//! *where applicable*, and "applicable" is not computable: a helper wrapping a `Result`-returning
//! read is idiomatic in Rust and pointless in a throwing language. So the judgement is made
//! **explicit, central and reviewed** — an exemption is written beside the operation, in gg, with a
//! prose reason, and never in the package that omits the operation, where the only evidence would be
//! an absence. An arm that omits a universal operation fails by name; an exemption naming an arm
//! that *does* bind the operation is dead and fails too, so a list of two cannot rot into a blanket
//! waiver.
//!
//! **Whether an operation takes input at all** ([`takes_input`]), per arm against gg. The shape of a
//! call is the arm's — an optional argument is an overload pair in one language and a default in
//! another — but a capability that needs a path needs one everywhere, and an arm whose model is told
//! what to put in a call and an arm whose model is not are not two spellings of one surface. It is
//! also what catches a reflector emitting an empty parameter list for everything: every signature
//! still renders, and every model on that arm is told every call takes nothing. A **receiver counts
//! as input**, because on a method whose receiver is the thing operated on it *is* the input, and a
//! rule that read only the parameter list would forbid an arm from binding a capability that way.
//!
//! **That every spelling is one a program could write** ([`usable_spellings`]). A name, a signature
//! that begins with it, one spelling per `(module, receiver)`, and a description on every argument
//! and every field of a structured one. Those four were always the majority of this gate's real
//! value and they are unchanged.
//!
//! The fifth is not old, and it is the one that carries the most weight. **Every function is
//! reached through a qualified name** — a module, a type, or an import — and never as a bare
//! identifier. Every arm's SDK is *static*, so a program can compile a call to a function a
//! [search](crate::docs::DocsRuntime::search) would never have shown it; the whole reason that
//! asymmetry is safe is that such a call never *looks* like an ordinary local one, and a model has
//! to write a qualifier naming gg to reach it. That is a property of eleven hand-written SDKs, so it
//! is held by a gate with a negative control rather than by convention.
//!
//! # What it explicitly does not check
//!
//! * **Nothing is compared between arms.** Not names, not counts, not documentation length, not how
//!   many functions a module groups. An arm that binds one operation as three overloads and a second
//!   arm that binds it as one call agree here, because they offer the same capability.
//! * **Nothing requires two arms to choose the same module, receiver or kind.** The grouping is what
//!   the model reads and is the arm's to choose; the cross-arm join is the operation id.
//! * **An alias is not propagated.** [`Applicability`] ranges over [`OPERATIONS`], so the
//!   propagation rule reaches a helper that is a *new capability* and stops there. A second
//!   spelling of a capability every arm already binds — `OpenView.close()` beside `views.close` —
//!   needs no row, no exemption and no reason, and this gate is silent about the difference by
//!   design. The tree measures this way today: five arms bind five such methods, two bind one, and
//!   four bind none. It is silent because the difference is one of
//!   **shape**: every arm can close a view, and requiring the rest to hang a method off the same
//!   declared type would be requiring eleven arms to agree on a receiver, which is the parity the
//!   re-founding retired. What it costs is real and is stated rather than hidden: an ergonomic
//!   affordance can differ between two arms of a study without anything going red.
//! * **Nothing is asked about a return.** [`usable_spellings`] holds every argument and every field
//!   of a structured one to being named and described; there is no matching rule for what a call
//!   hands back, and the asymmetry is a property of the schema rather than an omission here. A
//!   catalogue records a return as a *type reference*, which the name rule (`signatures.fqn.rs`)
//!   holds to resolving; it has nowhere to put return prose at all, so the only place an arm can
//!   explain what comes back is the detail paragraph, and holding a paragraph to mentioning one
//!   would be a register rule about content rather than a completeness rule about a field. Until
//!   the schema carries the field, this is a known gap.
//!
//! Two rules that used to be here now live elsewhere, and are stronger for it. Every brief, detail,
//! parameter description, type description and member description belongs to the register gate
//! (`language/register.rs`), which asks not only whether the prose is *there* but whether it is one
//! line, closes its code spans and is written in the register gg chose. Every fully-qualified name,
//! every module reference and every type reference belongs to the name rule
//! (`signatures.fqn.rs`), which also holds a declared type to being reachable and a reference to
//! resolving.
//!
//! One rule was **dropped rather than moved**, and it is worth naming. A non-tool function spelled
//! exactly as one of gg's own tool names used to fail: two vocabularies shared one flat program
//! scope, so a collision would have been resolved by bind order rather than by anyone's decision.
//! With a module-scoped surface there is no single flat scope to collide in — `read_file` under the
//! files module and `read_file` under another are two names, and shadowing *within* one grouping is
//! what [`usable_spellings`] still refuses. The hazard survives only on the arms that inject bare
//! names into a program's scope, and telling those apart needs a field in the catalogue saying so,
//! which no arm emits yet. Until one does, this is a known gap rather than a covered case.
//!
//! # And the things it cannot see, stated plainly
//!
//! **An arm that *swaps* two operations within one family** — labelling its `open_file` binding
//! `views.open_text` and vice versa — passes coverage, because both operations still have exactly
//! one canonical binding each. What is bound under the wrong gate there is legible only in the
//! function's own prose and spelling, which are the arm's and are not comparable to anything. The
//! gate catches every *unresolvable* and every *missing* operation, which is the shape the failure
//! takes when someone mistypes one id; a coherent two-sided swap is beyond it, and no gate that
//! refuses to compare spellings can reach it.
//!
//! **gg's own table can be mis-gated, and only within a family.** [`capabilities`] holds every row
//! to being bought by a capability gg paired with that row's *family*, and that fault would be worse
//! than an arm's: every arm reads its gates from this one table, so a run would withhold the call it
//! granted in all eleven at once. What the rule cannot see is a swap **within** one family — and
//! within one family there is nothing to swap, because a family's operations share one capability.
//! The rows where the binding is a decision rather than a restatement of the family all have a named
//! rule of their own ([`views`], [`documentation`], [`programs`], [`capabilities`], [`endings`]);
//! what is left to review is which of the filesystem capabilities buys which filesystem operation,
//! where the operation's own key names it.
//!
//! # Why it returns disagreements rather than asserting them
//!
//! A gate that only panics can be shown to pass; it cannot be shown to *catch* anything. Returning
//! the disagreements makes the gate's own failure mode testable, and [its tests](self::tests) hand
//! it deliberately damaged catalogues *and deliberately damaged operations tables* and assert on
//! what comes back. That is also why [`disagreements_against`] takes the table as a parameter:
//! [`OPERATIONS`] is a `const` no test can damage, and a gating rule nobody has watched fail is a
//! gating rule nobody knows works.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use test_cabinet_core::gg::{
    CAPABILITY_AGENT_MANAGED_CONTEXT, CAPABILITY_COMPACTION, CAPABILITY_DOCVIEW_CLOSE,
    CAPABILITY_EDIT_FILE, CAPABILITY_EXEC, CAPABILITY_FORK, CAPABILITY_LIST_DIR,
    CAPABILITY_MEMORIES, CAPABILITY_PROGRAM_LIBRARY, CAPABILITY_PROJECT_MANAGEMENT,
    CAPABILITY_READ_FILE, CAPABILITY_SEARCH, CAPABILITY_SHELL, CAPABILITY_SKILLS,
    CAPABILITY_SUBAGENTS, CAPABILITY_TASKS, CAPABILITY_WRITE_FILE, GgProgramLanguage,
};
use test_cabinet_core::gg_query::GG_CAPABILITY_CATALOG;

use super::{ProgramLanguage, all_languages};
use crate::ending::EndingRole;
use crate::sandbox::operations::{
    Applicability, Binding, FAMILY_CONTEXT, FAMILY_DELEGATION, FAMILY_DOCS, FAMILY_FILESYSTEM,
    FAMILY_MEMORY, FAMILY_PROGRAMS, FAMILY_PROJECT, FAMILY_SHELL, FAMILY_SKILLS, FAMILY_TASKS,
    FAMILY_VIEWS, OPERATIONS, Operation, OperationId,
};
use crate::sandbox::signatures::{CatalogueFunction, EntryKind, Parameter, SignatureEntry};
use crate::skills::builtin::FAMILIES;

/// What a complaint about gg's own [operations table](OPERATIONS) is filed under, where an arm's
/// complaint is filed under the arm's display name.
///
/// A gating fault is nobody's arm and everybody's problem: it mis-gates all eleven at once, because
/// all eleven read their gates from the one table.
pub(crate) const GG: &str = "gg";

/// One thing wrong: whose it is, and what.
///
/// The subject is a [display name](ProgramLanguage::display_name) rather than a wire id, because a
/// surface under test may not have one — the [fixture](super::fixture) does not, by construction —
/// and because gg itself is a possible subject.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Disagreement {
    /// Whose the complaint is: an arm's display name, or [`GG`].
    pub subject: &'static str,
    /// What is wrong with it, in one sentence, naming the operation or the binding at fault.
    pub detail: String,
}

impl fmt::Display for Disagreement {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.subject, self.detail)
    }
}

/// The operation that opens a **view of a file**, which is the one view call a gg tool gates.
const OPEN_FILE: &str = "open_file";

/// The operation that **closes** a view, and the one that **lists** what is open — the two view calls
/// that manage the window rather than fill it, bought by `agent-managed-context`.
const CLOSE: &str = "close";
const CURRENT: &str = "current";

/// The operation that **searches** the documentation, which is the one documentation call nothing
/// gates.
const SEARCH: &str = "search";

/// **Which families each capability buys part of** — the only pairs a [`Binding::Capability`] may be
/// written as, and the whole of what makes the host-side capability synthesis safe.
///
/// A capability id lives in gg and in nothing an arm commits, so the
/// [projection](crate::sandbox::catalogue_functions) can only carry one onto a catalogue entry by
/// reading it off this table's [`Binding`]. What that costs is stated here rather than assumed: a
/// capability appearing on an operation gg has not paired with a family is a gate nobody wrote down
/// the shape of, and it would document a withheld call or withhold a documented one with nothing
/// going red. It is also the one rule left that can catch a row bought by the **wrong** capability:
/// a memory operation gated on the board capability is invisible to every other check here and
/// would withhold, in all eleven arms at once, exactly the calls a run thought it had granted.
///
/// Most capabilities buy one family. The read capability buys two, and that is a real fact rather
/// than a loosening: opening a view of a file *is* a read, and the operation that does it belongs to
/// the view family because it puts material in the model's window.
///
/// The pairing is one-way about *coverage*. A family gg names here must have at least one operation
/// bought by the capability beside it, or the row is dead — but the converse does not hold, and the
/// documentation family is why: [`docs.search`](SEARCH) is bound to every program and its two
/// siblings are bought, so a rule requiring the whole family would be wrong. Which of a family's
/// operations the capability reaches is the family's own rule ([`programs`], [`documentation`]).
///
/// [`fsm`](test_cabinet_core::gg::CAPABILITY_FSM) is deliberately **absent**, and its absence is the
/// substance of the delegation family's one positional row. That capability is what makes a profile
/// the *shell* driving a machine, and a shell takes no turns; the agent running a state is an
/// ordinary profile that never declares it. So `delegation.transition_state` is bound by
/// [`Binding::Machine`] rather than by a capability, and a pairing here would be a gate synthesized
/// out of a switch no agent that can make the call ever holds.
const CAPABILITY_FAMILIES: &[(&str, &[&str])] = &[
    (CAPABILITY_SHELL, &[FAMILY_SHELL]),
    (CAPABILITY_READ_FILE, &[FAMILY_FILESYSTEM, FAMILY_VIEWS]),
    (CAPABILITY_WRITE_FILE, &[FAMILY_FILESYSTEM]),
    (CAPABILITY_EDIT_FILE, &[FAMILY_FILESYSTEM]),
    (CAPABILITY_LIST_DIR, &[FAMILY_FILESYSTEM]),
    (CAPABILITY_SEARCH, &[FAMILY_FILESYSTEM]),
    (CAPABILITY_SKILLS, &[FAMILY_SKILLS]),
    (CAPABILITY_MEMORIES, &[FAMILY_MEMORY]),
    (CAPABILITY_TASKS, &[FAMILY_TASKS]),
    (CAPABILITY_PROJECT_MANAGEMENT, &[FAMILY_PROJECT]),
    (
        CAPABILITY_AGENT_MANAGED_CONTEXT,
        &[FAMILY_CONTEXT, FAMILY_VIEWS],
    ),
    (CAPABILITY_COMPACTION, &[FAMILY_CONTEXT]),
    (CAPABILITY_SUBAGENTS, &[FAMILY_DELEGATION]),
    (CAPABILITY_EXEC, &[FAMILY_DELEGATION]),
    (CAPABILITY_FORK, &[FAMILY_DELEGATION]),
    (CAPABILITY_PROGRAM_LIBRARY, &[FAMILY_PROGRAMS]),
    (CAPABILITY_DOCVIEW_CLOSE, &[FAMILY_DOCS]),
];

/// Every way `languages` fail to describe one capability surface. Empty is the passing answer.
///
/// Held against gg's own [operations table](OPERATIONS) — there is no reference arm, and the order
/// the arms are given in decides nothing.
///
/// Every check is over catalogues alone, so this costs no component compile and can be run against
/// as many candidate surfaces as a test cares to build.
pub(crate) fn disagreements(languages: &[&'static dyn ProgramLanguage]) -> Vec<Disagreement> {
    disagreements_against(OPERATIONS, languages)
}

/// [`disagreements`], run against a **stated** operations table rather than against gg's own.
///
/// The table is a parameter for one reason: [`OPERATIONS`] is a `const`, so the gating rules below
/// could never be observed rejecting anything, and a rule that has only ever been watched pass is
/// indistinguishable from a rule that cannot fail. [Its tests](self::tests) hand it tables with one
/// row damaged and assert on the complaint that comes back.
pub(crate) fn disagreements_against(
    operations: &'static [Operation],
    languages: &[&'static dyn ProgramLanguage],
) -> Vec<Disagreement> {
    let mut out = Vec::new();
    gating(operations, &mut out);
    for language in languages {
        coverage(operations, *language, &mut out);
        takes_input(operations, *language, &mut out);
        usable_spellings(*language, &mut out);
    }
    out
}

// ---------------------------------------------------------------------------------------------
// Gating: the table alone
// ---------------------------------------------------------------------------------------------

/// **Every operation is bound under the right kind of gate**, asserted over the table and nothing
/// else.
///
/// This is where the checks that eleven arms each used to make about themselves ended up, and the
/// move made them stronger rather than weaker: a gate is a fact about gg's own configuration
/// surface, so eleven copies of it were eleven chances to disagree, and one copy checked once is
/// none. What an arm still says about a gate is only *which operation it is binding*, which
/// [`coverage`] holds it to.
fn gating(operations: &'static [Operation], out: &mut Vec<Disagreement>) {
    let mut complain = |detail: String| {
        out.push(Disagreement {
            subject: GG,
            detail,
        })
    };

    identities(operations, &mut complain);
    endings(operations, &mut complain);
    views(operations, &mut complain);
    documentation(operations, &mut complain);
    capabilities(operations, &mut complain);
    programs(operations, &mut complain);
    exemptions(operations, &mut complain);
}

/// Every row has an identity of its own, filed under a real family.
///
/// A duplicated id would put two gates on one operation and let whichever came first decide, and
/// would resolve two catalogue entries to one row. The family is checked against the skills library
/// because the family is the one grouping that survives every arm being idiomatic, and a grouping
/// pointing at nothing groups nothing.
///
/// The namespace and the family are separate strings — `files` against `gg-filesystem` — because a
/// skill's id is a handle a model reads and an operation id is not. Separate strings drift, so the
/// mapping is held to a bijection in both directions.
fn identities(operations: &'static [Operation], complain: &mut impl FnMut(String)) {
    let families: BTreeSet<&str> = FAMILIES.iter().map(|family| family.id).collect();
    let mut seen: BTreeSet<OperationId> = BTreeSet::new();
    let mut by_namespace: BTreeMap<&str, &str> = BTreeMap::new();
    let mut by_family: BTreeMap<&str, &str> = BTreeMap::new();

    for operation in operations {
        if operation.id.namespace.trim().is_empty() || operation.id.key.trim().is_empty() {
            complain(format!(
                "the operation `{}` has a blank half to its id",
                operation.id
            ));
        }
        if !seen.insert(operation.id) {
            complain(format!(
                "the operation `{}` is written down twice",
                operation.id
            ));
        }
        if !families.contains(operation.family) {
            complain(format!(
                "`{}` is filed under the family `{}`, which the skills library does not ship",
                operation.id, operation.family
            ));
        }
        if let Some(previous) = by_namespace.insert(operation.id.namespace, operation.family)
            && previous != operation.family
        {
            complain(format!(
                "the namespace `{}` covers two families, `{previous}` and `{}`",
                operation.id.namespace, operation.family
            ));
        }
        if let Some(previous) = by_family.insert(operation.family, operation.id.namespace)
            && previous != operation.id.namespace
        {
            complain(format!(
                "the family `{}` is filed under two namespaces, `{previous}` and `{}`",
                operation.family, operation.id.namespace
            ));
        }
    }
}

/// The ending operations are gg's three, under the roles gg gives them.
///
/// Read off [`EndingRole::tools`] rather than listed here, so the table is checked against gg's own
/// answer to "what may this role end with" and the two cannot be edited apart. A reviewer given
/// `finish` is a reviewer that can declare the work complete, which is not a verdict a reviewer is
/// asked for.
///
/// The roles themselves come from [`EndingRole::ALL`] for the same reason, and this file
/// deliberately keeps no list of its own: a role gg gained and a gate that had not heard of it
/// would compute no expectation for it at all, and an expectation of nothing agrees with a table
/// carrying nothing. `ALL` is held to the enum by a compile-time walk beside it.
fn endings(operations: &'static [Operation], complain: &mut impl FnMut(String)) {
    let mut expected: BTreeSet<(&str, &str)> = BTreeSet::new();
    for role in EndingRole::ALL {
        for tool in role.tools() {
            expected.insert((role.id(), *tool));
        }
    }
    let found: BTreeSet<(&str, &str)> = operations
        .iter()
        .filter_map(|operation| match operation.binding {
            Binding::Ending(role) => Some((role.id(), operation.id.key)),
            _ => None,
        })
        .collect();
    for (role, key) in expected.difference(&found) {
        complain(format!(
            "gg lets a `{role}` agent end with `{key}` and no operation offers it"
        ));
    }
    for (role, key) in found.difference(&expected) {
        complain(format!(
            "`{key}` is bound as a `{role}` ending, and gg does not offer that role that ending"
        ));
    }
}

/// A view is gated exactly where it reads the workspace or manages the window, and nowhere else.
///
/// Opening a view of a file is a **read** and is bought by the read capability. Closing a view is
/// **context management** and is bought by `agent-managed-context`, the
/// capability that buys every other call an agent manages its window with. The rest of the view
/// surface — opening a text the program computed, opening documentation gg holds — is bound to every
/// program whatever a run enables, because a run that offers no tools at all must still be able to
/// show its model something. A gate that slipped onto the wrong one would silently withhold the only
/// channel into the context window, or silently open a side door into the workspace, and neither
/// shows up as a compile error.
fn views(operations: &'static [Operation], complain: &mut impl FnMut(String)) {
    for operation in operations
        .iter()
        .filter(|operation| operation.family == FAMILY_VIEWS)
    {
        let expected = if operation.id.key == OPEN_FILE {
            Binding::Capability(CAPABILITY_READ_FILE)
        } else if operation.id.key == CLOSE || operation.id.key == CURRENT {
            Binding::Capability(CAPABILITY_AGENT_MANAGED_CONTEXT)
        } else {
            Binding::Always
        };
        if operation.binding != expected {
            complain(format!(
                "the view `{}` is bound by {:?} where gg binds it by {expected:?}",
                operation.id, operation.binding
            ));
        }
    }
}

/// **Every capability buys a family gg paired it with**, the id it names is a real one, and no
/// pairing is dead.
///
/// This is the invariant the whole host-side synthesis rests on: the capability id lives in gg and
/// in nothing an arm commits, so the *only* reason a catalogue can stay ignorant of it is that gg
/// knows, per operation, which capability reaches it. A capability appearing on a row gg has not
/// paired with that row's family would be a gate whose shape nobody wrote down — and the
/// [projection](crate::sandbox::catalogue_functions) would carry it onto the entry regardless,
/// silently documenting a withheld call or withholding a documented one.
///
/// The dead-pairing half is the same rule [`Applicability`]'s dead exemptions are held to, and it
/// bites in the same way: a row in [`CAPABILITY_FAMILIES`] naming a family nothing in it is bought
/// by is a waiver left behind after the operations it excused were re-gated, and it makes the next
/// capability written into that family look reviewed when it was not. It is checked per *pair*
/// rather than per capability, so the read capability's claim on the view family cannot be kept
/// alive by its claim on the filesystem one.
fn capabilities(operations: &'static [Operation], complain: &mut impl FnMut(String)) {
    let catalog: BTreeSet<&str> = GG_CAPABILITY_CATALOG.iter().copied().collect();
    let mut bought: BTreeSet<(&str, &str)> = BTreeSet::new();
    for operation in operations {
        let Binding::Capability(id) = operation.binding else {
            continue;
        };
        bought.insert((id, operation.family));
        if !catalog.contains(id) {
            complain(format!(
                "`{}` is bought by `{id}`, which is not a gg capability",
                operation.id
            ));
        }
        match CAPABILITY_FAMILIES
            .iter()
            .find(|(capability, _)| *capability == id)
        {
            None => complain(format!(
                "`{}` is bought by the capability `{id}`, which gg pairs with no family — a \
                 capability gate is synthesized host-side from the family an operation sits in, so \
                 there is nothing for it to be synthesized from",
                operation.id
            )),
            Some((_, families)) if !families.contains(&operation.family) => complain(format!(
                "`{}` is filed under `{}` and is bought by `{id}`, which buys {}",
                operation.id,
                operation.family,
                named_families(families)
            )),
            Some(_) => {}
        }
    }
    for (capability, families) in CAPABILITY_FAMILIES {
        for family in *families {
            if !bought.contains(&(*capability, *family)) {
                complain(format!(
                    "the capability `{capability}` is paired with the `{family}` family and buys \
                     nothing in it — a pairing that gates no operation is a waiver waiting to be \
                     appended to"
                ));
            }
        }
    }
}

/// The families a capability is paired with, as a sentence names them — ``the `gg-programs`
/// family`` for one, ``the `gg-filesystem` and `gg-views` families`` for two.
///
/// A complaint is read by whoever is holding a table gg has rejected, so it is written the way the
/// pairing itself is written rather than as a debug rendering: a bare `gg-programs` in the middle of
/// a sentence reads as prose, and the family it names is exactly the string that has to be found in
/// [`CAPABILITY_FAMILIES`] to fix it.
fn named_families(families: &[&str]) -> String {
    let quoted: Vec<String> = families
        .iter()
        .map(|family| format!("`{family}`"))
        .collect();
    let noun = if quoted.len() == 1 {
        "family"
    } else {
        "families"
    };
    format!("the {} {noun}", quoted.join(" and "))
}

/// The [program library](crate::programs) is bought whole, by its own capability.
///
/// It is the one family where the capability is the *only* gate on every member: the object is
/// bound or absent entire, because an agent that may fetch a program it ran may re-run it, and one
/// that may do neither has no library at all.
fn programs(operations: &'static [Operation], complain: &mut impl FnMut(String)) {
    for operation in operations
        .iter()
        .filter(|operation| operation.family == FAMILY_PROGRAMS)
    {
        if operation.binding != Binding::Capability(CAPABILITY_PROGRAM_LIBRARY) {
            complain(format!(
                "`{}` belongs to the program library and is bound by {:?} rather than by the \
                 capability that buys the whole family",
                operation.id, operation.binding
            ));
        }
    }
}

/// **Searching the documentation is bound to every program; closing a documentation view is bought.**
///
/// The [views](views) rule from the other side, and load-bearing for the same reason. With the
/// [prompt](crate::prompts) naming no function, a search is how an agent learns what it holds — so a
/// run able to withhold it could withhold an agent's knowledge of its own capabilities, and a gate
/// that slipped onto this row would do exactly that in all eleven arms at once. What the agent may
/// *find* is still per agent, because the runtime filters every hit through
/// [`Grants::permits`](crate::sandbox::Grants::permits), so the call being unconditional costs
/// nothing a capability was buying.
///
/// Closing is the exception and is bought by
/// [`docview-close`](test_cabinet_core::gg::CAPABILITY_DOCVIEW_CLOSE): an open only ever appends to
/// the prompt, where a close rewrites its middle and costs the run every cached token after it.
/// Whether that trade pays is a measurement, so it is a toggle.
fn documentation(operations: &'static [Operation], complain: &mut impl FnMut(String)) {
    for operation in operations
        .iter()
        .filter(|operation| operation.family == FAMILY_DOCS)
    {
        let expected = if operation.id.key == SEARCH {
            Binding::Always
        } else {
            Binding::Capability(CAPABILITY_DOCVIEW_CLOSE)
        };
        if operation.binding != expected {
            complain(format!(
                "the documentation call `{}` is bound by {:?} where gg binds it by {expected:?}",
                operation.id, operation.binding
            ));
        }
    }
}

/// Every [exemption](Applicability::UniversalExcept) is one somebody wrote down a reason for.
///
/// The reason being *required* is the whole of the clause's value, and its absence is invisible from
/// every other angle: the arm really does not bind the operation, so [`coverage`]'s dead-exemption
/// converse stays quiet, and the operation is waived on that arm for good with nothing recorded. It
/// is a `const` assertion in the [table itself](crate::sandbox::operations) as well, and the two are
/// not redundant: there it fails a `cargo check`, before there is a green suite to be reassured by,
/// and here it can be *watched* rejecting a damaged table, which a `const` over a `const` table
/// never can.
///
/// An empty exemption *list* fails too: `UniversalExcept(&[])` is [`Applicability::Universal`] said
/// in a way that reads like a waiver, and a row that reads like a waiver is one a later edit will
/// append to without re-deriving whether it should exist at all.
fn exemptions(operations: &'static [Operation], complain: &mut impl FnMut(String)) {
    for operation in operations {
        let Applicability::UniversalExcept(exemptions) = operation.applies else {
            continue;
        };
        if exemptions.is_empty() {
            complain(format!(
                "`{}` excuses nobody — an empty exemption list is `Universal`, and should be \
                 spelled that way",
                operation.id
            ));
        }
        let mut excused: BTreeSet<GgProgramLanguage> = BTreeSet::new();
        for (language, reason) in exemptions {
            if reason.trim().is_empty() {
                complain(format!(
                    "`{}` is excused on `{language}` with no reason — an exemption's reason is \
                     prose, required, and reviewed, because it is the only record of why that arm \
                     is permanently waived",
                    operation.id
                ));
            }
            if !excused.insert(*language) {
                complain(format!("`{}` excuses `{language}` twice", operation.id));
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Coverage: one arm at a time, against gg
// ---------------------------------------------------------------------------------------------

/// **Every operation this arm is expected to offer, it offers exactly once** — and everything it
/// offers is an operation gg has.
///
/// Coverage counts **canonical bindings**. An [alias](CatalogueFunction::alias_of) is a second way
/// to reach one operation — a free function beside the method on the type it operates on, a block
/// form beside a keyword form — and counts toward nothing, so an arm that idiomatically offers one
/// capability twice is not thereby ahead of an arm that offers it once. Nothing here counts
/// functions, modules, or anything else an arm chose for itself.
fn coverage(
    operations: &'static [Operation],
    language: &'static dyn ProgramLanguage,
    out: &mut Vec<Disagreement>,
) {
    let subject = language.display_name();
    let mut complain = |detail: String| out.push(Disagreement { subject, detail });

    // The arm's identity mapping: operation id → the bindings it wrote for it. A `Vec` rather than
    // one value because two canonical bindings of one operation is precisely the thing to report,
    // and reporting it needs both.
    let mut canonical: BTreeMap<OperationId, Vec<Shape>> = BTreeMap::new();
    let mut aliases: Vec<(String, &'static str)> = Vec::new();

    for function in crate::sandbox::catalogue_functions(language) {
        let named = named(&function);
        let id = function.operation;
        let Some(operation) = resolve(operations, id) else {
            complain(format!(
                "`{named}` binds the operation `{id}`, which gg does not have — an entry gg cannot \
                 resolve is offered under no gate at all, and is dropped from search, from every \
                 directory and from every documentation view"
            ));
            continue;
        };
        match function.alias_of {
            Some(alias) => aliases.push((named, alias)),
            None => canonical
                .entry(operation.id)
                .or_default()
                .push(Shape::of(&function)),
        }
    }

    for (id, bindings) in &canonical {
        if bindings.len() > 1 {
            let listed = bindings
                .iter()
                .map(|shape| format!("{shape}"))
                .collect::<Vec<_>>()
                .join(", and ");
            complain(format!(
                "binds `{id}` {} times over — as {listed}. An arm's second way to reach one \
                 operation is an alias, and an alias says so with `aliasOf`",
                bindings.len()
            ));
        }
    }

    for (named, alias) in aliases {
        match resolve(operations, alias) {
            None => complain(format!(
                "`{named}` is an alias of `{alias}`, which gg does not have"
            )),
            Some(operation) if !canonical.contains_key(&operation.id) => complain(format!(
                "`{named}` is an alias of `{alias}`, which this arm binds nowhere — an alias is a \
                 *second* way to reach an operation, so one standing alone leaves the operation \
                 uncovered and itself gated by something it does not offer"
            )),
            Some(_) => {}
        }
    }

    for operation in operations {
        let bound = canonical.contains_key(&operation.id);
        match (bound, excused(operation, language)) {
            (true, None) | (false, Some(_)) => {}
            (false, None) => complain(format!(
                "gg offers `{}` and this arm binds it nowhere — bind it, or write an exemption \
                 with a reason beside the operation",
                operation.id
            )),
            (true, Some(reason)) => complain(format!(
                "`{}` is excused here ({reason}), and this arm binds it — the exemption is dead, \
                 and a dead exemption is how a list of two becomes a blanket waiver",
                operation.id
            )),
        }
    }
}

/// **Whether a program passes an operation anything is gg's answer, and every arm documents it.**
///
/// Asked of the canonical bindings alone: an alias is free to take a different shape of the same
/// capability, so a parameterless alias must not be able to answer on a parameter-taking binding's
/// behalf, or the other way about.
///
/// The defect this exists for is a reflector that emits an empty parameter list for everything. The
/// documentation still renders, every signature still looks plausible, and every model on that arm
/// is told every call takes nothing.
///
/// **A receiver is input.** `view.close()` on a handle to the view it closes takes an argument —
/// the view — and documents no parameter, because the parameter is the thing the call hangs off.
/// That is the idiomatic binding in every language with methods, and a rule that read only the
/// parameter list would forbid an arm from choosing it, which is shape parity by another route:
/// every parameterised operation would have to keep a free function to satisfy the gate. So the
/// half of this rule that demands a documented argument is asked of receiverless bindings only.
///
/// The other half is unaffected and stays: an arm that documents an argument where gg says the
/// operation takes nothing is wrong however it bound the call. What the exemption costs is narrow
/// and worth naming — a *two*-input operation bound as a method whose second parameter the
/// reflector dropped reads here as a receiver supplying the one input gg knows about, and gg's
/// table records whether an operation takes input rather than how much of it.
fn takes_input(
    operations: &'static [Operation],
    language: &'static dyn ProgramLanguage,
    out: &mut Vec<Disagreement>,
) {
    let subject = language.display_name();
    let mut complain = |detail: String| out.push(Disagreement { subject, detail });

    for function in crate::sandbox::catalogue_functions(language) {
        if function.alias_of.is_some() {
            continue;
        }
        let Some(operation) = resolve(operations, function.operation) else {
            // Already reported, in the sentence that diagnoses it.
            continue;
        };
        // Folded across the shapes, because an overload group legitimately contains a nullary shape
        // beside one that takes a path: `listDir()` and `listDir(String)` are one capability, and it
        // takes an argument.
        let documented = function
            .signatures
            .iter()
            .any(|entry| !entry.parameters.is_empty());
        // A receiver stands in for a documented argument, and only in the direction where its
        // absence would otherwise read as an omission.
        let takes = documented || function.receiver.is_some();
        let complaint = match (documented, takes, operation.takes_input) {
            (true, _, false) => Some(("documents an argument", "nothing")),
            (_, false, true) => Some(("documents no argument", "input")),
            _ => None,
        };
        if let Some((documents, takes)) = complaint {
            complain(format!(
                "`{}`, which binds `{}`, {documents} in any of its shapes, where gg says the \
                 operation takes {takes}",
                named(&function),
                operation.id
            ));
        }
    }
}

/// The **shape** one arm gave one operation: where it is documented, what kind of declaration it is,
/// what it hangs off, and what a program calls it.
///
/// This is the identity of a *binding*, and it exists to name one in a complaint and to tell two of
/// them apart. It is deliberately never compared between arms: which of these an arm chose is the
/// whole of what being idiomatic means, and the cross-arm join is the operation id beside it.
struct Shape {
    /// The module it is documented under, in the arm's own spelling.
    module: &'static str,
    /// What kind of declaration the arm made of it.
    kind: EntryKind,
    /// The declared type it hangs off, where it hangs off one.
    receiver: Option<&'static str>,
    /// The name a program calls it by.
    name: &'static str,
}

impl Shape {
    /// The shape of one catalogued binding.
    fn of(function: &CatalogueFunction) -> Self {
        Self {
            module: function.object,
            kind: function.kind,
            receiver: function.receiver,
            name: function.name,
        }
    }
}

impl fmt::Display for Shape {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let kind = match self.kind {
            EntryKind::Function => "a function",
            EntryKind::Method => "a method",
            EntryKind::StaticMethod => "a static method",
            EntryKind::Initializer => "an initializer",
        };
        write!(f, "`{}`, {kind}", self.name)?;
        if let Some(receiver) = self.receiver {
            write!(f, " on `{receiver}`")?;
        }
        write!(f, " in `{}`", self.module)
    }
}

/// How a complaint names one binding: its fully-qualified name, which is the key everything gg emits
/// about it uses.
fn named(function: &CatalogueFunction) -> String {
    function.fqn.to_string()
}

/// The row of `operations` the rendered id `id` names, or `None` for one no row carries.
///
/// Resolution goes through the **stated** table rather than through
/// [`operation_by_id`](crate::sandbox::operations::operation_by_id), so that a damaged table is
/// really the table this gate reads. The split is at the first dot, which is safe by construction:
/// an [`OperationId`]'s key is `snake_case` and its namespace is one word.
fn resolve(operations: &'static [Operation], id: &str) -> Option<&'static Operation> {
    let (namespace, key) = id.split_once('.')?;
    operations
        .iter()
        .find(|operation| operation.id.namespace == namespace && operation.id.key == key)
}

/// The reason `operation` is excused on `language`, or `None` where it is not excused there.
fn excused(
    operation: &'static Operation,
    language: &'static dyn ProgramLanguage,
) -> Option<&'static str> {
    let Applicability::UniversalExcept(exemptions) = operation.applies else {
        return None;
    };
    let id = registered_id(language)?;
    exemptions
        .iter()
        .find(|(excused, _)| *excused == id)
        .map(|(_, reason)| *reason)
}

/// The wire id of `language`, or `None` for a surface that is not a registered arm.
///
/// It is resolved by *finding* the language in the registry rather than by asking it, because
/// [`id`](ProgramLanguage::id) panics on the [fixture](super::fixture) — deliberately, since a
/// fixture that could be named in a config file would be a fixture that could be run. An exemption
/// names a `GgProgramLanguage`, so a surface with no wire id can never be the arm one names, and
/// answering `None` here says exactly that rather than working around a panic.
fn registered_id(language: &'static dyn ProgramLanguage) -> Option<GgProgramLanguage> {
    all_languages()
        .find(|registered| registered.display_name() == language.display_name())
        .map(|registered| registered.id())
}

// ---------------------------------------------------------------------------------------------
// Spellings: what a program could write
// ---------------------------------------------------------------------------------------------

/// **Every spelling an arm offers is one a program can write, and it offers each of them once.**
///
/// These are the rules about a *signature* and its *arguments* — the ones no other gate asks, and
/// the ones that were always the majority of this gate's value. They read the
/// [normalized projection](crate::sandbox::catalogue_functions), so one implementation covers every
/// arm however its own reflector spells things.
fn usable_spellings(language: &'static dyn ProgramLanguage, out: &mut Vec<Disagreement>) {
    let subject = language.display_name();
    let mut complain = |detail: String| out.push(Disagreement { subject, detail });

    // Spelled once each, per grouping and receiver. Two entries under one module sharing a name is
    // one of them shadowing the other at the call site — and a member function legitimately shares a
    // name with a free function, which is why the receiver is part of the key rather than ignored.
    let mut seen: BTreeSet<(&str, Option<&str>, &str)> = BTreeSet::new();
    for function in crate::sandbox::catalogue_functions(language) {
        let where_ = function.fqn;
        if function.name.trim().is_empty() {
            complain(format!("`{where_}` has no name a program could call"));
        }
        if !qualified(function.fqn, function.name) {
            complain(format!(
                "`{where_}` is offered under a bare name: a call this agent may not make must \
                 never look like an ordinary local one, so every gg function is reached through a \
                 module, a type or an import"
            ));
        }
        if !seen.insert((function.object, function.receiver, function.name)) {
            complain(format!(
                "two functions on `{}` are both spelled `{}`",
                function.object, function.name
            ));
        }
        if function.signatures.is_empty() {
            complain(format!("`{where_}` has no signature"));
        }
        for SignatureEntry {
            signature,
            parameters,
        } in function.signatures
        {
            if signature.trim().is_empty() {
                complain(format!("`{where_}` has an empty signature"));
            } else if !signature.starts_with(function.name) {
                complain(format!(
                    "`{where_}`'s signature does not start with the name a program calls \
                     (`{}`): {signature}",
                    function.name
                ));
            }
            if parameters.is_empty() && declares_arguments(signature) {
                complain(format!(
                    "`{where_}` takes arguments and documents none: {signature}"
                ));
            }
            for parameter in parameters {
                check_parameter(
                    parameter,
                    where_,
                    signature,
                    names_arguments(signature),
                    &mut complain,
                );
            }
        }
    }
}

/// **Whether `fqn` reaches `name` through something** — a module, a namespace, a package or a type
/// — rather than offering it as a bare identifier.
///
/// This is the condition the whole [static SDK](crate::sandbox::Grants) design rests on, and it is
/// the reason one accepted consequence of that design is safe. Every arm's SDK carries every
/// function whatever the run enabled, so a program can *compile* a call that a
/// [search](crate::docs::DocsRuntime::search) would never have shown it. What keeps that from being
/// a trap is that such a call cannot look like an ordinary one: the model has to write a qualifier
/// that names gg. A surface offering `readFile` as a free identifier would put a call the agent
/// cannot make in the same shape as a call to its own helper.
///
/// Checked on the **fully-qualified name**, because that is the one field every arm's reflector
/// resolves to what a program would have to write — `gg.files.readFile`, `gg::files::read_file`,
/// `Gg.Files.ReadFile`, `GG::Views::OpenView#close`. A separator is enough: what the qualifier *is*
/// differs per language and none of them is gg's to choose.
fn qualified(fqn: &'static str, name: &'static str) -> bool {
    let Some(prefix) = fqn.strip_suffix(name) else {
        // An arm whose fqn does not end in the name it calls the function by is answering a
        // different question from the one asked; treated as unqualified rather than excused, since
        // nothing here can tell what a program would write.
        return false;
    };
    prefix
        .chars()
        .next_back()
        .is_some_and(|last| !last.is_alphanumeric() && last != '_')
}

/// Every parameter is named, documented, and named *in the signature it belongs to*.
///
/// The last of the three is what catches the defect this gate exists for: a parameter renamed in the
/// signature and left behind under its old name in the documentation reads perfectly and tells a
/// model to write something the call will not accept. It is checked by substring rather than by
/// parsing, because parsing a signature would need a parser per language, and every language spells
/// a parameter's name into its own signature whichever side of the type it puts it on.
fn check_parameter(
    parameter: &'static Parameter,
    where_: &str,
    signature: &'static str,
    named: bool,
    complain: &mut impl FnMut(String),
) {
    let name = parameter.name.trim();
    if name.is_empty() {
        complain(format!("`{where_}` has an argument with no name"));
        return;
    }
    if parameter.doc.trim().is_empty() {
        complain(format!("`{where_}`'s `{name}` has no documentation"));
    }
    if named && !signature.contains(name) {
        complain(format!(
            "`{where_}` documents an argument `{name}` its signature does not name: {signature}"
        ));
    }
    // A **field** is named by the signature whichever notation the language writes, because it is
    // part of a structured value's own type and a language that renders that type renders its
    // labels. So the half of this check that actually protects a call site — a renamed field left
    // behind in the documentation, which tells a model to write a key the call will refuse — holds
    // for every arm, ML notation included.
    for field in &parameter.fields {
        check_parameter(field, where_, signature, true, complain);
    }
}

/// Whether a signature **names** its arguments, which decides whether a documented argument's name
/// can be looked for in it.
///
/// Every language with a call syntax writes its parameter names into its signature, and one written
/// in ML notation writes none — there is nowhere in `String -> { limit :: Int } -> Effect FileRead`
/// for a name to go, because that notation names types and not parameters. Requiring such a
/// signature to contain `path` would make an ML-notation language impossible to register, which is a
/// worse failure than the renamed-parameter defect the check prevents — and the half of that defect
/// which can mislead a call site is caught anyway, since a *field* of a structured argument is named
/// by the type either way.
fn names_arguments(signature: &str) -> bool {
    !is_ml_notation(signature)
}

/// Whether a signature is written in **ML notation** — a name, `::` and a type — rather than as a
/// call with a bracketed argument list.
///
/// The one notation-level distinction this gate makes, and it makes it because the two notations put
/// their argument list in different places: a call writes one between brackets, an ML type writes one
/// as a chain of top-level arrows.
fn is_ml_notation(signature: &str) -> bool {
    signature.contains(" :: ")
}

/// Whether an ML-notation signature's type takes an argument: a `->` at the top level of it, outside
/// every bracket.
///
/// `current :: Effect (Array OpenView)` takes nothing and `readFile :: String -> Effect FileRead`
/// takes one, which the bracket rule cannot tell apart — it sees the parentheses around
/// `Array OpenView` and reads them as an argument list.
fn ml_declares_arguments(signature: &str) -> bool {
    let Some((_, kind)) = signature.split_once(" :: ") else {
        return false;
    };
    let mut depth = 0usize;
    let bytes = kind.as_bytes();
    for (offset, byte) in bytes.iter().enumerate() {
        match byte {
            b'(' | b'{' | b'[' => depth += 1,
            b')' | b'}' | b']' => depth = depth.saturating_sub(1),
            b'-' if depth == 0 && bytes.get(offset + 1) == Some(&b'>') => return true,
            _ => {}
        }
    }
    false
}

/// Whether a signature writes an argument list at all: its first parenthesised group, matched to its
/// own closing bracket, with something in it.
///
/// Deliberately shallow, and deliberately not a parser — a parser would be one per language. Every
/// language that writes its arguments between brackets is covered by this one rule, which is every
/// language that has a call syntax at all: `shell(command: string)`, `fn read_file(path: &str)`,
/// `func readFile(path: String) throws`. A signature written in ML notation
/// (`readFile :: String -> Effect FileRead`) has no bracket to look inside, and is read by
/// [`ml_declares_arguments`] instead: its arguments are the chain of top-level arrows, which is where
/// that notation puts them. The bracket rule was wrong about such a signature in both directions —
/// `current :: Effect (Array OpenView)` looked like it took an argument, and
/// `readFile :: String -> Effect FileRead` looked like it took none — and [`takes_input`], which
/// holds every arm to gg's own answer about the call, is the second line of defence rather than the
/// only one.
fn declares_arguments(signature: &str) -> bool {
    if is_ml_notation(signature) {
        return ml_declares_arguments(signature);
    }
    let Some(open) = signature.find('(') else {
        return false;
    };
    let mut depth = 0usize;
    for (offset, character) in signature[open..].char_indices() {
        match character {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    return !signature[open + 1..open + offset].trim().is_empty();
                }
            }
            _ => {}
        }
    }
    // Unbalanced brackets: malformed rather than argument-free. Complaining here would be a second
    // sentence about one defect, and the name and doc checks above already have it.
    false
}

#[cfg(test)]
#[path = "agreement.test.rs"]
mod tests;
