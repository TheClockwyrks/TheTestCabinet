use std::collections::BTreeSet;

use super::*;
use crate::sandbox::all_languages;
use test_cabinet_core::gg::GgProgramLanguage;

/// Every arm, with the document the page serves for it — the fixture almost every test here walks,
/// because the property being asserted is nearly always "on *every* arm".
///
/// Eleven documents is roughly a second to build, which is why they are built once per test rather
/// than once per assertion.
fn documents() -> Vec<(GgProgramLanguage, GgReferenceApi)> {
    GgProgramLanguage::ALL
        .iter()
        .map(|id| (*id, api(*id)))
        .collect()
}

/// The entries of one document that are functions, or that are types.
fn of_kind(document: &GgReferenceApi, kind: GgReferenceEntryKind) -> Vec<&GgReferenceEntry> {
    document
        .entries
        .iter()
        .filter(|entry| entry.kind == kind)
        .collect()
}

/// **Every function every arm's catalogue documents is on that arm's page**, with a body, a brief
/// and the identity a reader navigates by.
///
/// This is the property the owner's ruling names: the page is the full surface gg offers, so a
/// catalogued call that the maximal grant failed to bind — or that the runtime declined to render —
/// would be a call gg has and the console does not show. The set is keyed by the **fully-qualified
/// name**, which is the catalogue's own key and the one thing on an entry that is unique: a
/// `(module, name)` pair is not, because a convenience method on a value is documented under its
/// receiver's module and free to be spelled the way the operation it aliases is.
#[test]
fn every_catalogued_function_is_documented() {
    for (id, document) in documents() {
        let arm = language(id);
        let emitted: BTreeSet<&str> = of_kind(&document, GgReferenceEntryKind::Function)
            .iter()
            .map(|entry| entry.fqn.as_str())
            .collect();
        let catalogued = catalogue_functions(arm);
        assert_eq!(
            emitted.len(),
            catalogued.len(),
            "{}'s page must carry one entry per catalogued function, and nothing else",
            id.id()
        );
        for function in &catalogued {
            let key = function.fqn;
            assert!(
                emitted.contains(key),
                "{}'s `{key}` is documented by the catalogue and missing from the page",
                id.id()
            );
        }

        for entry in of_kind(&document, GgReferenceEntryKind::Function) {
            assert!(
                !entry.body.trim().is_empty(),
                "{}'s `{}` came out with no documentation at all",
                id.id(),
                entry.fqn
            );
            assert!(
                !entry.brief.trim().is_empty(),
                "{}'s `{}` came out with no summary",
                id.id(),
                entry.fqn
            );
            assert!(
                entry.operation.is_some(),
                "{}'s `{}` binds no gg operation, so nothing can say what gates it",
                id.id(),
                entry.fqn
            );
        }
    }
}

/// **Every type every arm declares is on the page**, and none is orphaned.
///
/// A type is rendered only when some function the maximal grant binds refers to it — the same gate
/// a run's own lookup applies — so a declaration nothing reaches would silently vanish from the
/// page while remaining in the catalogue. It does not happen on any arm today, and this is what
/// makes that a fact rather than an assumption: a reflector that emitted a type no signature
/// mentions fails here rather than shipping a page that is quietly short.
#[test]
fn every_declared_type_is_documented() {
    for (id, document) in documents() {
        let declared: BTreeSet<&str> = language(id)
            .catalogue()
            .types
            .iter()
            .map(TypeDeclaration::key)
            .collect();
        let emitted: BTreeSet<&str> = of_kind(&document, GgReferenceEntryKind::Type)
            .iter()
            .map(|entry| entry.fqn.as_str())
            .collect();
        assert_eq!(
            emitted,
            declared,
            "{}'s page must carry a view of every type its catalogue declares",
            id.id()
        );

        for entry in of_kind(&document, GgReferenceEntryKind::Type) {
            assert!(
                !entry.body.trim().is_empty() && !entry.brief.trim().is_empty(),
                "{}'s `{}` came out with an empty view",
                id.id(),
                entry.fqn
            );
            assert!(
                entry.operation.is_none() && entry.returns.is_empty(),
                "{}'s `{}` is a type and must carry none of a call's fields",
                id.id(),
                entry.fqn
            );
        }
    }
}

/// **A body is the string a documentation view renders, not a rendering assembled here.**
///
/// It cannot be asserted by comparing against a second renderer — a second renderer is the thing
/// this page exists not to have — so it is asserted against the two facts that would break if
/// anything ever started assembling one: a function's body opens with a shape the catalogue
/// declares it in, and a type's body opens with the declaration the catalogue carries. Both are
/// what `assemble` and `declare` put first, and neither is a string this crate composes.
#[test]
fn every_body_opens_the_way_a_documentation_view_opens() {
    for (id, document) in documents() {
        let arm = language(id);
        for entry in of_kind(&document, GgReferenceEntryKind::Function) {
            let function = catalogue_functions(arm)
                .into_iter()
                .find(|function| function.fqn == entry.fqn)
                .expect("every emitted function is a catalogued one");
            let first = &function.signatures[0].signature;
            assert!(
                entry.body.starts_with(first.as_str()),
                "{}'s `{}` does not open with the signature the catalogue declares",
                id.id(),
                entry.fqn
            );
            assert!(
                entry.body.contains(&entry.brief),
                "{}'s `{}` does not carry its own brief, so the body is not the view's",
                id.id(),
                entry.fqn
            );
        }
        for entry in of_kind(&document, GgReferenceEntryKind::Type) {
            let declaration = type_declaration(arm, &entry.fqn).expect("an emitted type declares");
            assert!(
                entry.body.starts_with(declaration.declaration.as_str()),
                "{}'s `{}` does not open with its declaration",
                id.id(),
                entry.fqn
            );
        }
    }
}

/// **Both ending roles are on the page, and only the functions differ between them.**
///
/// The page is the pool, so a reviewer's verdict calls and a worker's `finish` are all on it even
/// though no single run binds both — which is the whole reason a runtime is built per role. What
/// the second role must *not* change is a type's body: a type view lists the member functions the
/// grant permits, so if a role ever gated one, taking each type from the first runtime that answers
/// would quietly drop it. Nothing does today, and this says so rather than assuming it.
#[test]
fn both_ending_roles_reach_the_page_and_agree_about_every_type() {
    for (id, document) in documents() {
        let endings: BTreeSet<&str> = document
            .entries
            .iter()
            .filter_map(|entry| entry.ending.as_deref())
            .collect();
        assert!(
            endings.len() > 1,
            "{}'s page carries only the ending calls of one role: {endings:?}",
            id.id()
        );

        // The same maximal grant the page itself is rendered through — every capability that gates
        // a call, and every operation those capabilities offer — so what is compared between the two
        // roles is the role and nothing else.
        let capabilities: Vec<String> = gating_capabilities()
            .into_iter()
            .map(str::to_string)
            .collect();
        let operations = capability_operations(capabilities.iter().map(String::as_str));
        let mut per_role = EndingRole::ALL
            .into_iter()
            .map(|role| DocsRuntime::new(capabilities.clone(), role, &operations, id));
        let (first, second) = (
            per_role.next().expect("a first role"),
            per_role.next().expect("a second role"),
        );
        for entry in of_kind(&document, GgReferenceEntryKind::Type) {
            assert_eq!(
                first.read_type(&entry.fqn),
                second.read_type(&entry.fqn),
                "{}'s `{}` reads differently to the two ending roles",
                id.id(),
                entry.fqn
            );
        }
    }
}

/// Every entry is filed under a module the same document declares, and every module says what a
/// page needs to render its folder.
///
/// The page is a folder per module with its entries inside, so an entry whose module is not in the
/// list has no folder to sit in: it vanishes from the page while remaining in the payload, which is
/// the one failure no reader of the page can diagnose.
#[test]
fn every_entry_is_filed_under_a_declared_module() {
    for (id, document) in documents() {
        let declared: BTreeSet<&str> = document
            .modules
            .iter()
            .map(|module| module.id.as_str())
            .collect();
        for entry in &document.entries {
            assert!(
                declared.contains(entry.module.as_str()),
                "{}'s `{}` is filed under `{}`, which the document does not declare",
                id.id(),
                entry.fqn,
                entry.module
            );
        }
        for module in &document.modules {
            assert!(
                !module.path.trim().is_empty() && !module.summary.trim().is_empty(),
                "{}'s `{}` carries no spelling or no line to render it by",
                id.id(),
                module.id
            );
        }
    }
}

/// The entries arrive in the order a model meets them: module by module in the arm's own order,
/// functions before the types declared beside them.
///
/// Asserted because the order is the page's navigation. A projection that emitted the catalogue's
/// order would scatter one module's calls through the list, and nothing about the payload would say
/// so — the folders would still be right and the reading order would not.
#[test]
fn the_entries_walk_the_modules_in_the_arm_s_own_order() {
    for (id, document) in documents() {
        let position = |module: &str| {
            document
                .modules
                .iter()
                .position(|declared| declared.id == module)
                .expect("every entry is filed under a declared module")
        };
        let mut walked: Vec<(usize, bool)> = document
            .entries
            .iter()
            .map(|entry| {
                (
                    position(&entry.module),
                    entry.kind == GgReferenceEntryKind::Type,
                )
            })
            .collect();
        let emitted = walked.clone();
        walked.sort_by_key(|(module, is_type)| (*module, *is_type));
        assert_eq!(
            emitted,
            walked,
            "{}'s entries are not in module order with each module's functions first",
            id.id()
        );
    }
}

/// Every type a signature refers to resolves to a declaration on the same page.
///
/// The projection drops a name the catalogue does not declare rather than emitting a link to
/// nothing, which is the right behaviour for a corrupt artifact and the wrong thing to discover in
/// production — so the count is asserted here, where a regenerated catalogue that lost a
/// declaration fails the build instead. The **returns** and the two open-sets are checked too,
/// because each is a list of keys the page turns into links.
#[test]
fn every_referenced_type_resolves_to_a_declaration() {
    for (id, document) in documents() {
        let arm = language(id);
        let emitted: BTreeSet<&str> = of_kind(&document, GgReferenceEntryKind::Type)
            .iter()
            .map(|entry| entry.fqn.as_str())
            .collect();
        for entry in of_kind(&document, GgReferenceEntryKind::Function) {
            let function = catalogue_functions(arm)
                .into_iter()
                .find(|function| function.fqn == entry.fqn)
                .expect("every emitted function is a catalogued one");
            assert_eq!(
                entry.types.len(),
                function
                    .types
                    .iter()
                    .map(|reference| reference.fqn())
                    .collect::<BTreeSet<&str>>()
                    .len(),
                "{}'s `{}` refers to a type the catalogue does not declare",
                id.id(),
                entry.fqn
            );
            for key in entry
                .types
                .iter()
                .chain(&entry.returns)
                .chain(&entry.opens_under_return)
                .chain(&entry.opens_under_return_and_parameters)
            {
                assert!(
                    emitted.contains(key.as_str()),
                    "{}'s `{}` links to `{key}`, which has no entry on the page",
                    id.id(),
                    entry.fqn
                );
            }
        }
    }
}

/// What a lookup **opens** is one level deep, and the transitive list beside it is not — which is
/// the whole reason both are carried.
///
/// If the two were ever the same the page could carry one. On at least one arm they differ, and
/// the difference is a function's own signature against the closure under it.
#[test]
fn what_a_lookup_opens_is_narrower_than_the_closure_beside_it() {
    let mut narrower = 0;
    for (_, document) in documents() {
        for entry in of_kind(&document, GgReferenceEntryKind::Function) {
            for opened in &entry.opens_under_return_and_parameters {
                assert!(
                    entry.types.contains(opened),
                    "`{}` opens `{opened}`, which its own closure does not contain",
                    entry.fqn
                );
            }
            if entry.opens_under_return_and_parameters.len() < entry.types.len() {
                narrower += 1;
            }
        }
    }
    assert!(
        narrower > 0,
        "no entry on any arm opens fewer types than its closure holds — the two lists have \
         collapsed into one, and the page is carrying the same thing twice"
    );
}

/// Every arm is registered, and the projection reaches all of them by asking the registry rather
/// than by carrying a list of its own.
#[test]
fn the_projection_covers_every_registered_arm() {
    assert_eq!(
        all_languages().count(),
        GgProgramLanguage::ALL.len(),
        "the arm list the projection walks is the registry's"
    );
}
