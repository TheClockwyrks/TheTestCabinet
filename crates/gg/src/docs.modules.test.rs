//! **The definition-of-done gate for what a documentation view has to say about *where* a symbol
//! lives** — asserted over every registered arm, and over every key a model can open a view by.
//!
//! # Why this is a gate rather than a case
//!
//! gg's system prompt names the modules a program's surface is divided into and **no function at
//! all**. Everything else a model learns about a call it learns from two places: a search hit, which
//! is a key and a brief, and the view it then opens. So the view is the only text in a run that can
//! answer the three questions standing between reading a signature and writing the call — *is this
//! the function I want, how is it called, and how does my program reach it?* A view that renders a
//! signature and never says which module it came out of answers two of the three, and the model pays
//! for the third with a compile error it has no way to diagnose.
//!
//! That makes the line [`DocsRuntime::defined_in`](super::DocsRuntime::defined_in) renders a
//! requirement of the surface rather than a nicety of one renderer, and a requirement of the surface
//! is held by a gate over the **whole** surface: eleven arms, every function key each of them binds,
//! every type key each of them declares. Sampling one arm and one function would have passed on the
//! day this shipped and would go on passing while an arm added a module, a kind of entry, or a
//! second renderer that forgot.
//!
//! # What is asserted, and why in both directions
//!
//! For every key, the body carries a `Defined in ` line, that line names the module by **this arm's
//! own path** — `gg.files`, `gg::files`, `Gg.Files`, `gg.files.Files` — and, where the arm declares
//! [a line a program writes](crate::sandbox::ModuleView::import) to bring the module into scope, the
//! body quotes that line verbatim.
//!
//! Both states of that field are live: PureScript declares a real import line for every module it
//! has, and the other ten arms declare none because gg puts their SDK in a program's scope before
//! the model's code is compiled. A gate that only asserted the state it happened to find would be
//! satisfied by a renderer that handled one and dropped the other, so the `Some` half is asserted
//! wherever an arm declares one and the run is checked at the end to have actually exercised it.
//!
//! The two vacuity guards at the bottom of each arm exist for the same reason. A view is asserted
//! only where one renders, and "no view rendered" is exactly what a broken grant, a renamed key or a
//! reshuffled catalogue looks like — so an arm that produced no function view and no type view fails
//! here rather than passing silently having checked nothing.

use std::collections::{BTreeMap, BTreeSet};

use super::*;
use crate::sandbox::{
    all_languages, capability_operations, catalogue_modules, gating_capabilities,
    instance_operations,
};

/// One arm's modules, as the pair every assertion below reads: gg's [module
/// id](crate::sandbox::ModuleView::id) — the string a function and a type each carry — mapped to
/// this arm's own path and the line (if any) a program writes to reach it.
type Modules = BTreeMap<&'static str, (&'static str, Option<&'static str>)>;

/// [`catalogue_modules`], keyed by the id a catalogued entry names its module by.
fn modules(arm: &'static dyn ProgramLanguage) -> Modules {
    catalogue_modules(arm)
        .into_iter()
        .map(|module| (module.id, (module.path, module.import)))
        .collect()
}

/// A runtime holding **the whole surface** on `id`, in `role`.
///
/// The maximal grant, assembled the way the console's reference page assembles it: every capability
/// that gates any part of the surface, every operation those capabilities offer, and the operations
/// an agent holds by its *position* in a machine rather than by any capability. A grant assembled
/// from capabilities alone would leave `transition_state` — and every key that reaches it — outside
/// a gate whose whole claim is that it covers every key.
fn everything(id: GgProgramLanguage, role: EndingRole) -> DocsRuntime {
    let capabilities: Vec<String> = gating_capabilities()
        .into_iter()
        .map(str::to_string)
        .collect();
    let mut operations = capability_operations(capabilities.iter().map(String::as_str));
    operations.extend(instance_operations());
    DocsRuntime::new(capabilities, role, &operations, id)
}

/// **One view says where its symbol is defined, in this arm's own spelling, and how a program
/// reaches it** — the assertion this whole file is made of, with everything a failure needs to be
/// actionable: the arm, what kind of view it was, the key that opened it and the body it rendered.
fn assert_defined_in(
    arm: &str,
    kind: &str,
    key: &str,
    module: (&'static str, Option<&'static str>),
    body: &str,
) {
    let (path, import) = module;
    let defined = body
        .lines()
        .find(|line| line.starts_with("Defined in "))
        .unwrap_or_else(|| {
            panic!(
                "{arm}: the {kind} view `{key}` never says which module defines it. It is defined \
                 in `{path}`, and a model reading this has no way to qualify the call it just \
                 read:\n{body}"
            )
        });
    assert!(
        defined.contains(path),
        "{arm}: the {kind} view `{key}` is defined in `{path}` and says `{defined}` — the module \
         has to be named by this arm's own path, because the path is what a program \
         writes:\n{body}"
    );
    let Some(import) = import else {
        return;
    };
    assert!(
        defined.contains(import),
        "{arm}: the {kind} view `{key}` is reached with `{import}` and says `{defined}` — this arm \
         declares a line a program must write, so the view has to quote it verbatim:\n{body}"
    );
}

/// **Every documentation view a model can open names the module its symbol is defined in**, on every
/// registered arm, for every function key and every type key that arm binds.
///
/// # Which keys count
///
/// Every string a model has been shown and may type back, because a view opens under all of them and
/// a model has no way to tell them apart:
///
/// * a function's [fully-qualified name](crate::sandbox::CatalogueFunction::fqn) — what a search hit
///   is filed under — and the bare [name](crate::sandbox::CatalogueFunction::name) a call site
///   writes;
/// * a type's key, its bare name, and the **spelling** every signature writes it under
///   (`Files.FileRead`, `files::FileRead`), which is the string a model most often copies because it
///   is printed inside the signature of the function whose view it just opened.
///
/// A type key is asserted against the module of whatever it *resolved* to rather than the
/// declaration the key was collected from, so that the gate holds even for a spelling that resolves
/// somewhere other than where a reader would guess — what is being asserted is that a rendered body
/// names its own module, not that a lookup went where this test expected.
///
/// Both [ending roles](EndingRole), because the three ending calls are bound one group per role and
/// a key no role binds is a key no model is ever shown.
#[test]
fn every_docview_names_the_module_it_is_defined_in() {
    // Whether the `Some(import)` half of `assert_defined_in` ran at all. See the file header: a
    // renderer that dropped it must not be able to pass by way of ten arms that declare none.
    let mut imports_asserted = 0usize;

    for arm in all_languages() {
        let name = arm.display_name();
        let modules = modules(arm);
        assert!(
            !modules.is_empty(),
            "{name}: the catalogue divides the surface into no modules at all, so nothing below \
             could be asserted"
        );
        let with_a_line = modules
            .values()
            .filter(|(_, import)| import.is_some())
            .count();

        // Where each of this arm's functions is documented, by the key its own view is filed under.
        // A view is asserted against the module of whatever the key *resolved* to rather than of
        // the entry the key was collected from, because a bare name is not unique across modules —
        // `close` is `gg.views.close` and `gg.docs.close` on every arm, and a model typing it is
        // shown one of them. What must hold is that the body a lookup rendered names its own
        // module; which entry a lenient spelling reaches is a different question, asked by
        // `docview_key`'s own tests.
        let function_modules: BTreeMap<&'static str, &'static str> = catalogue_functions(arm)
            .iter()
            .map(|function| (function.fqn, function.module))
            .collect();

        let mut functions = 0usize;
        let mut types = 0usize;
        // Per arm rather than cumulative: a running total would be satisfied for PureScript and
        // then trivially true for every arm after it.
        let mut arm_imports = 0usize;
        for role in EndingRole::ALL {
            let docs = everything(arm.id(), role);

            // Both spellings a model is shown, for every function this grant binds: the key it read
            // in a search hit, and the bare name it writes at a call site.
            let mut keys: BTreeSet<&'static str> = BTreeSet::new();
            for function in catalogue_functions(arm) {
                if docs.bound(&function) {
                    keys.insert(function.fqn);
                    keys.insert(function.name);
                }
            }
            for key in keys {
                let body = docs.read(key).unwrap_or_else(|| {
                    panic!("{name}: `{key}` is a name this arm advertises and opens no view")
                });
                let opened = docs.docview_key(key).unwrap_or_else(|| {
                    panic!("{name}: `{key}` rendered a view and resolves to no key")
                });
                let module = *function_modules
                    .get(opened.as_str())
                    .and_then(|module| modules.get(module))
                    .unwrap_or_else(|| {
                        panic!(
                            "{name}: `{key}` opens `{opened}`, which is filed under a module its \
                             catalogue does not declare — so its view can say nothing true about \
                             where it is defined"
                        )
                    });
                assert_defined_in(name, "function", key, module, &body);
                functions += 1;
                arm_imports += usize::from(module.1.is_some());
            }

            // Every string a type answers to, gathered before any is opened: its own key, its bare
            // name, and every spelling some signature on this arm writes it under.
            let mut keys: BTreeSet<&'static str> = BTreeSet::new();
            for declaration in &arm.catalogue().types {
                keys.insert(declaration.key());
                keys.insert(declaration.name.as_str());
            }
            for function in catalogue_functions(arm) {
                for reference in function.returns.iter().chain(function.types) {
                    keys.insert(reference.spelled());
                }
            }
            for key in keys {
                // A type no bound function reaches renders no view, and withholding it is the
                // permission filter doing its job rather than a gap in this one.
                let Some(body) = docs.read_type(key) else {
                    continue;
                };
                let declaration = type_declaration(arm, key).unwrap_or_else(|| {
                    panic!("{name}: `{key}` rendered a type view and resolves to no declaration")
                });
                let module = *modules.get(declaration.module.as_str()).unwrap_or_else(|| {
                    panic!(
                        "{name}: the type `{}` is filed under the module `{}`, which its catalogue \
                         does not declare — so its view can say nothing true about where it is \
                         defined",
                        declaration.key(),
                        declaration.module
                    )
                });
                assert_defined_in(name, "type", key, module, &body);
                types += 1;
                arm_imports += usize::from(module.1.is_some());
            }
        }

        assert!(
            functions > 0 && types > 0,
            "{name}: this gate rendered {functions} function views and {types} type views, so it \
             asserted nothing about this arm"
        );
        assert!(
            with_a_line == 0 || arm_imports > 0,
            "{name}: {with_a_line} of its modules declare an import line and not one view was held \
             to quoting it"
        );
        imports_asserted += arm_imports;
    }

    assert!(
        imports_asserted > 0,
        "no arm declared an import line, so the half of this gate that holds a view to quoting one \
         never ran. If an arm's SDK stopped needing a line, the state it moved to is the one every \
         other arm is in — and this gate has to keep proving both."
    );
}
