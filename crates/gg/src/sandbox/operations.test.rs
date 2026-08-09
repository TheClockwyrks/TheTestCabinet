//! The gates that keep [`OPERATIONS`] honest.
//!
//! Two kinds live here, and the difference matters. The first kind reads the table alone and holds
//! it to vocabularies gg owns elsewhere — the [families](crate::skills), the
//! [ending roles](EndingRole), the capability catalog. Those are the checks
//! that stop a row from being *invented*.
//!
//! The second kind reads the table against **every registered language's committed catalogue**, one
//! arm at a time and never one arm against another. They are what make it safe for
//! [`DocsRuntime::bound`](crate::docs::DocsRuntime::bound) to have stopped asking an arm what gates
//! its own functions: if gg's answer and an arm's declaration ever disagreed, a model would be shown
//! documentation for a call its scope does not bind — the one thing a directory must never do — and
//! nothing else in the tree would notice.
//!
//! The tool bijection is deliberately **not** here. It is a `const` assertion in the module itself,
//! so a tool added to gg fails the build rather than a test run.

use std::collections::{BTreeMap, BTreeSet};

use test_cabinet_core::gg_query::GG_CAPABILITY_CATALOG;

use super::*;
use crate::skills::builtin::FAMILIES;

use crate::sandbox::catalogue_functions;
use crate::sandbox::language::all_languages;

/// How gg's own [ending roles](EndingRole) are spelled in a catalogue's `ending` field, paired with
/// the role itself — the one place this test module needs the string form, since the table carries
/// the typed role.
const ROLE_SPELLINGS: [(EndingRole, &str); 2] = [
    (EndingRole::Standard, "standard"),
    (EndingRole::Review, "review"),
];

/// Every row has an identity of its own, and the transitional join is one-to-one with it.
///
/// A duplicated id would put two gates on one operation and let whichever came first in the table
/// decide; a duplicated call would resolve two catalogue entries to one row.
#[test]
fn every_operation_is_identified_exactly_once() {
    let ids: BTreeSet<String> = OPERATIONS.iter().map(|op| op.id.to_string()).collect();
    assert_eq!(
        ids.len(),
        OPERATIONS.len(),
        "two operations share one id: {ids:?}"
    );
    let calls: BTreeSet<(&str, &str)> = OPERATIONS
        .iter()
        .map(|op| (op.call.object, op.call.key))
        .collect();
    assert_eq!(
        calls.len(),
        OPERATIONS.len(),
        "two operations claim one `(object, key)` pair"
    );
}

/// An id is namespaced on its family, and the namespace names exactly one family.
///
/// The two vocabularies are separate strings — `files` against `gg-filesystem` — because a skill's
/// id is a handle a model reads and an operation id is not. Separate strings drift, so the mapping
/// is held to a bijection: no family filed under two namespaces, and no namespace covering two
/// families. Every family named must also be a family the skills library actually ships, or the
/// grouping points at nothing.
#[test]
fn each_id_is_namespaced_on_exactly_one_real_family() {
    let families: BTreeSet<&str> = FAMILIES.iter().map(|family| family.id).collect();
    let mut by_namespace: BTreeMap<&str, &str> = BTreeMap::new();
    let mut by_family: BTreeMap<&str, &str> = BTreeMap::new();
    for operation in OPERATIONS {
        assert!(
            families.contains(operation.family),
            "`{}` is filed under `{}`, which is not a skills family",
            operation.id,
            operation.family
        );
        assert!(
            !operation.id.namespace.is_empty() && !operation.id.key.is_empty(),
            "`{}` has a blank half to its id",
            operation.id
        );
        if let Some(previous) = by_namespace.insert(operation.id.namespace, operation.family) {
            assert_eq!(
                previous, operation.family,
                "the namespace `{}` covers two families",
                operation.id.namespace
            );
        }
        if let Some(previous) = by_family.insert(operation.family, operation.id.namespace) {
            assert_eq!(
                previous, operation.id.namespace,
                "the family `{}` is filed under two namespaces",
                operation.family
            );
        }
    }
}

/// The id's key is the key the catalogue join uses.
///
/// While [`Operation::call`] exists at all, an id whose key said one thing and whose join said
/// another would be two names for one operation with nothing choosing between them. When the join
/// goes, the id is what is left — so it has to be right now, while there is still something to check
/// it against.
#[test]
fn an_ids_key_is_the_key_it_is_catalogued_under() {
    for operation in OPERATIONS {
        assert_eq!(
            operation.id.key, operation.call.key,
            "`{}` is catalogued under the key `{}`",
            operation.id, operation.call.key
        );
    }
}

/// The ending operations are gg's three, under the roles gg gives them.
///
/// Read off [`EndingRole::tools`] rather than listed here, so the table is checked against gg's own
/// answer to "what may this role end with" and the two cannot be edited apart. A reviewer given
/// `finish` is a reviewer that can declare the work complete, which is not a verdict a reviewer is
/// asked for.
#[test]
fn the_ending_operations_are_gg_s_three_under_gg_s_roles() {
    let mut expected: BTreeSet<(&str, &str)> = BTreeSet::new();
    for (role, spelling) in ROLE_SPELLINGS {
        for tool in role.tools() {
            expected.insert((spelling, *tool));
        }
    }
    let found: BTreeSet<(&str, &str)> = OPERATIONS
        .iter()
        .filter_map(|operation| match operation.binding {
            Binding::Ending(role) => {
                let spelling = ROLE_SPELLINGS
                    .iter()
                    .find(|(candidate, _)| *candidate == role)
                    .map(|(_, spelling)| *spelling)
                    .expect("every ending role is spelled");
                Some((spelling, operation.id.key))
            }
            _ => None,
        })
        .collect();
    assert_eq!(
        found, expected,
        "the ending operations must be exactly gg's ending calls, each under its own role"
    );
}

/// A capability buys the [program library](crate::programs) and nothing else, and the id it names is
/// a real one.
///
/// This is the invariant the whole host-side synthesis rests on: the capability id lives here, in
/// gg, and the *only* reason an arm's catalogue can stay ignorant of it is that exactly one family
/// is bought this way and gg knows which. A second capability appearing in the table without the
/// synthesis in
/// [`catalogue_functions`](crate::sandbox::catalogue_functions) learning about it would silently
/// document a withheld family.
#[test]
fn the_program_library_is_the_only_family_a_capability_buys() {
    let catalog: BTreeSet<&str> = GG_CAPABILITY_CATALOG.iter().copied().collect();
    let bought: BTreeSet<String> = OPERATIONS
        .iter()
        .filter_map(|operation| match operation.binding {
            Binding::Capability(id) => {
                assert!(
                    catalog.contains(id),
                    "`{}` is bought by `{id}`, which is not a gg capability",
                    operation.id
                );
                Some(operation.id.to_string())
            }
            _ => None,
        })
        .collect();
    assert_eq!(
        bought,
        BTreeSet::from([
            "programs.get".to_string(),
            "programs.history".to_string(),
            "programs.rerun".to_string(),
        ]),
        "only the program library is bought by a capability today"
    );
    for operation in OPERATIONS {
        if operation.family == FAMILY_PROGRAMS {
            assert_eq!(
                operation.binding,
                Binding::Capability(CAPABILITY_PROGRAM_LIBRARY),
                "`{}` belongs to the program library and must be gated by it",
                operation.id
            );
        }
    }
}

/// A view is gated exactly where it reads the workspace, and nowhere else.
///
/// `openFile` is a read and is bound when `read_file` is; the rest of the view surface is bound to
/// every program whatever a run enables, because a run that offers no tools at all must still be
/// able to show its model something. A gate that slipped onto the wrong one would silently withhold
/// the only channel into the context window, or silently open a side door into the workspace.
#[test]
fn a_view_is_gated_only_where_it_reads_the_workspace() {
    for operation in OPERATIONS {
        if operation.family != FAMILY_VIEWS {
            continue;
        }
        let expected = if operation.id.key == "open_file" {
            Binding::Tool(crate::tools::READ_FILE_TOOL)
        } else {
            Binding::Always
        };
        assert_eq!(
            operation.binding, expected,
            "`{}` is bound by {:?} where gg binds it by {expected:?}",
            operation.id, operation.binding
        );
    }
}

/// **Every function every registered arm catalogues resolves to an operation.**
///
/// A function with no row is a call gg has no identity to gate, record or document under — so
/// [`bound`](crate::docs::DocsRuntime::bound) would answer `false` for it and the model would never
/// be shown a function its own scope binds. This is the test that makes that `None` arm unreachable
/// rather than merely unlikely.
///
/// The same absence is a silent *undercount* one layer down, which is what the check was originally
/// written for: the [membrane](crate::sandbox) records a call under the pair this join is keyed on,
/// so a function with no row is one the model calls, the console reports as offered and never
/// called, and nothing anywhere contradicts. It is the exact converse of
/// `language.test.rs`'s `every_model_facing_call_resolves_in_every_language` — that one proves no
/// row is invented, this one proves none is missing — and the two live apart because the row, not
/// the catalogue, is now what a run reads.
///
/// [`list`](crate::docs::LIST_FUNCTION) is the one exclusion, and it is excluded from the
/// *catalogue* too: the guest seeds it onto every object rather than exporting it once, so it has no
/// entry on either side to compare.
#[test]
fn every_catalogued_function_has_an_operation() {
    for language in all_languages() {
        for function in catalogue_functions(language) {
            assert!(
                operation_of(&function).is_some(),
                "{}: the catalogue binds `{}.{}` (spelled `{}`), which gg has no operation for",
                language.display_name(),
                function.object,
                function.key,
                function.name
            );
        }
    }
}

/// **And every operation is offered by every arm that is not excused.**
///
/// This is D11's propagation rule, enforced: an operation added here goes red on every arm until
/// that arm binds it or an [exemption](Applicability::UniversalExcept) with a written reason is
/// added beside the operation. The converse is checked too — an exemption naming a language that
/// *does* bind the operation is dead, and dead exemptions are how a list of two becomes a blanket
/// waiver.
///
/// **Provisional, and it does not discharge the propagation check the re-founded agreement gate
/// owes.** It is keyed on the transitional [`Operation::call`] join, so it must be rewritten when
/// each arm writes its operation id on the declaration and the join goes. More importantly it was
/// written against eleven arms that already agree, with no way to make it fail: every operation is
/// [`Applicability::Universal`] today, so the dead-exemption branch below has never once been
/// reached by the suite. A check whose failing paths have never run is a check nobody has evidence
/// about, and eleven green arms are not that evidence. The gate is kept here because it is real
/// cover against a regression *now*, not because it is finished — the version that counts is the one
/// driven by the reshaping fixture, which must be made to fail on a missing operation and on a dead
/// exemption before either is believed.
#[test]
fn every_operation_is_offered_by_every_arm_that_is_not_excused() {
    for language in all_languages() {
        let catalogued: BTreeSet<(&str, &str)> = catalogue_functions(language)
            .iter()
            .map(|function| (function.object, function.key))
            .collect();
        for operation in OPERATIONS {
            let bound = catalogued.contains(&(operation.call.object, operation.call.key));
            let excused = match operation.applies {
                Applicability::Universal => None,
                Applicability::UniversalExcept(exemptions) => exemptions
                    .iter()
                    .find(|(excused, _)| *excused == language.id())
                    .map(|(_, reason)| *reason),
            };
            match (bound, excused) {
                (true, None) | (false, Some(_)) => {}
                (false, None) => panic!(
                    "{}: gg offers `{}` and this arm does not bind it — bind it, or write an \
                     exemption with a reason",
                    language.display_name(),
                    operation.id
                ),
                (true, Some(reason)) => panic!(
                    "{}: `{}` is excused here ({reason}), and this arm binds it — the exemption is \
                     dead",
                    language.display_name(),
                    operation.id
                ),
            }
        }
    }
}

/// **What gg says binds an operation is what every arm's catalogue declares about it.**
///
/// The bridge between the two halves of stage one, and the reason re-pointing
/// [`bound`](crate::docs::DocsRuntime::bound) at this table changed no behaviour: the gate fields an
/// arm reflects (`requires`, `ending`) and the one gg synthesizes from section membership
/// (`capability`) must project onto exactly the [`Binding`] written here. When the arms stop
/// carrying gate fields at all, this test goes with them — until then it is what proves gg's copy is
/// not a second opinion.
#[test]
fn every_operations_binding_is_what_every_arm_declares() {
    for language in all_languages() {
        for function in catalogue_functions(language) {
            let operation = operation_of(&function).expect("every catalogued function has one");
            let declared = (function.gate, function.ending, function.capability);
            let expected = match operation.binding {
                Binding::Tool(tool) => (Some(tool), None, None),
                Binding::Ending(role) => {
                    let spelling = ROLE_SPELLINGS
                        .iter()
                        .find(|(candidate, _)| *candidate == role)
                        .map(|(_, spelling)| *spelling)
                        .expect("every ending role is spelled");
                    (None, Some(spelling), None)
                }
                Binding::Capability(id) => (None, None, Some(id)),
                Binding::Always => (None, None, None),
            };
            assert_eq!(
                declared,
                expected,
                "{}: `{}` is declared (gate {:?}, ending {:?}, capability {:?}) where gg binds it \
                 by {:?}",
                language.display_name(),
                operation.id,
                function.gate,
                function.ending,
                function.capability,
                operation.binding,
            );
        }
    }
}

/// **`takes_input` is what every arm documents.**
///
/// The defect this exists for is a reflector that emits an empty parameter list for everything: the
/// documentation still renders, every signature still looks plausible, and every model on that arm
/// is told a call takes nothing. Held per arm against gg rather than arm against arm, so it survives
/// the arms being reshaped into different shapes of the same operation.
///
/// **Provisional on the same terms as the propagation check above**: keyed on the transitional
/// [`Operation::call`] join, and never yet observed failing. It is also the check whose looseness
/// would be hardest to see — it reads "any signature documents a parameter", which is the right
/// question for today's one-shape-per-function arms and becomes a weaker one the moment an arm binds
/// an operation twice, since an alias with parameters would answer for a canonical binding without
/// them. The version that counts is the one written against a fixture carrying an alias, and it must
/// be made to fail on a takes-input mismatch before it is believed.
#[test]
fn takes_input_is_what_every_arm_documents() {
    for language in all_languages() {
        for function in catalogue_functions(language) {
            let operation = operation_of(&function).expect("every catalogued function has one");
            let documented = function
                .signatures
                .iter()
                .any(|entry| !entry.parameters.is_empty());
            assert_eq!(
                documented,
                operation.takes_input,
                "{}: `{}` documents {} argument-taking shape(s) where gg says it takes {}",
                language.display_name(),
                operation.id,
                function.signatures.len(),
                if operation.takes_input {
                    "input"
                } else {
                    "nothing"
                },
            );
        }
    }
}
