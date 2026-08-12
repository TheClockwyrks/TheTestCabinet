//! One arm's responses-as-code surface, rendered by the runtime a model's own lookups go through.
//!
//! # There is one renderer, and it is not here
//!
//! Every [body](GgReferenceEntry::body) on this page is a string
//! [`DocsRuntime`] produced — [`read`](DocsRuntime::read) for a function,
//! [`read_type`](DocsRuntime::read_type) for a type — which is the same call `view.openDocsView(…)`
//! reaches at the membrane. Nothing here formats a signature, describes an argument or lays out a
//! member list. That is the whole point of the file: a page assembled from structured fields is a
//! second renderer, and however faithful it is the day it is written it is a second thing to keep
//! true. The structured fields that remain are the ones a page needs to **file, link and filter**
//! an entry — a module id, a category, a list of type names — and none of them is prose.
//!
//! What it costs is stated on [the wire type](GgReferenceEntry): a block cannot be filtered by
//! parameter, folded, or linkified from the inside. The links come from the name lists beside the
//! block.
//!
//! # The maximal scope
//!
//! The runtime is built from a grant that holds **everything**: every gg tool enabled, both
//! [surface capabilities](crate::sandbox::surface_capabilities), and — because
//! [`Binding::Ending`](crate::sandbox::Binding) is exact equality and no single grant can be both —
//! one runtime per [ending role](EndingRole), searched in order. That is what makes this the pool
//! rather than a view: a reviewer's `approve` and a worker's `finish` are both on the page, and no
//! run has both.
//!
//! Exactly **one byte** of a body depends on the grant, and it is worth knowing which: `assemble`
//! is ungated, and a type's rendering filters only its member-function block by
//! [`Grants::permits`](crate::sandbox::Grants). So the maximal rendering differs from any real run's
//! in one way — it lists every member function a value offers — which is precisely "the full surface
//! gg offers".

use std::collections::BTreeSet;

use test_cabinet_core::gg::GgProgramLanguage;
use test_cabinet_core::gg_reference::{
    GgReferenceApi, GgReferenceEntry, GgReferenceEntryKind, GgReferenceModule,
};

use crate::docs::{DocViewTypes, DocsRuntime};
use crate::ending::EndingRole;
use crate::sandbox::{
    CatalogueFunction, ProgramLanguage, TypeDeclaration, catalogue_functions, catalogue_modules,
    family_of_module, language, operation_of, surface_capabilities, type_declaration,
};
use crate::tools::ALL_TOOL_NAMES;

/// One [program language](GgProgramLanguage)'s whole surface: the modules it is divided into, and a
/// documentation view of every function and type in it.
pub(super) fn api(id: GgProgramLanguage) -> GgReferenceApi {
    let arm = language(id);
    let modules = modules(arm);
    let views = views(id);

    let functions: Vec<GgReferenceEntry> = catalogue_functions(arm)
        .iter()
        .filter_map(|function| documented_function(arm, &views, function))
        .collect();
    let types: Vec<GgReferenceEntry> = arm
        .catalogue()
        .types
        .iter()
        .filter_map(|declaration| documented_type(&views, declaration))
        .collect();

    GgReferenceApi {
        gg_version: super::gg_version(),
        language: id,
        entries: ordered(&modules, functions, types),
        modules,
    }
}

/// The [modules](GgReferenceModule) this arm's surface is divided into, in the order that arm
/// presents them.
///
/// The order is the **catalogue's**, not the families': it is the order the module list in a real
/// system prompt renders in, so the page walks the surface in the sequence a model actually meets
/// it. Nothing is filtered — a module with no callable function is still part of the surface, and
/// its declarations are what the types on the functions above it refer to.
///
/// Every field is read off the catalogue except the family, which is joined through gg's
/// [operations table](crate::sandbox::family_of_module) on the module id. That join is the point of
/// the id existing: the module *path* is one arm's spelling and belongs to no family, while the id
/// is the namespace every operation in the module is filed under.
fn modules(arm: &'static dyn ProgramLanguage) -> Vec<GgReferenceModule> {
    catalogue_modules(arm)
        .into_iter()
        .map(|module| GgReferenceModule {
            id: module.id.to_string(),
            path: module.path.to_string(),
            summary: module.prose.brief.to_string(),
            category: family_of_module(module.id).map(str::to_string),
            import: module.import.map(str::to_string),
        })
        .collect()
}

/// A maximal [documentation runtime](DocsRuntime) per [ending role](EndingRole), in the order gg
/// offers the roles.
///
/// Two runtimes rather than one because an ending call is bound by *exact* role equality — a
/// reviewer has `approve` and `request_changes` and no `finish`, and a worker the reverse — so a
/// single grant cannot reach the whole surface however much else it holds. Everything else about
/// them is identical, so a lookup takes the first that answers and the second exists only for the
/// three ending calls.
fn views(id: GgProgramLanguage) -> Vec<DocsRuntime> {
    let enabled: Vec<String> = ALL_TOOL_NAMES
        .iter()
        .map(|name| (*name).to_string())
        .collect();
    // Both, resolved on: this is the pool, and a capability nobody granted withholds part of it.
    let capabilities = surface_capabilities(true, true);
    EndingRole::ALL
        .into_iter()
        .map(|role| DocsRuntime::new(enabled.clone(), role, &capabilities, id))
        .collect()
}

/// One catalogued function as the page carries it, or `None` for one no maximal grant binds — which
/// is drift rather than a run-time condition, and which `every_catalogued_function_is_documented`
/// proves cannot happen.
fn documented_function(
    arm: &'static dyn ProgramLanguage,
    views: &[DocsRuntime],
    function: &CatalogueFunction,
) -> Option<GgReferenceEntry> {
    // The fully-qualified name where the arm emits one, which is what a view is opened by; the bare
    // name is the fallback a v1 arm is keyed by, and the runtime accepts either.
    let key = function.fqn.unwrap_or(function.name);
    let view = views.iter().find(|view| view.bound(function))?;
    Some(GgReferenceEntry {
        kind: GgReferenceEntryKind::Function,
        fqn: key.to_string(),
        name: function.name.to_string(),
        // gg's id for the module, so the page's folders and its entries are joined on the one name
        // that is not a spelling — and so a reader comparing two arms is comparing the same module
        // rather than two strings that happen to differ.
        module: function.module.unwrap_or(function.object).to_string(),
        category: category_of(function),
        brief: function.prose.brief.to_string(),
        body: view.read(key)?,
        operation: function.operation.map(str::to_string),
        alias_of: function.alias_of.map(str::to_string),
        receiver: function.receiver.map(str::to_string),
        gate: function.gate.map(str::to_string),
        ending: function.ending.map(str::to_string),
        capability: function.capability.map(str::to_string),
        types: declared(arm, function.types.iter().map(|kind| kind.fqn())),
        returns: declared(arm, function.returns.iter().map(|kind| kind.fqn())),
        opens_under_return: opened(view, key, DocViewTypes::ReturnOnly),
        opens_under_return_and_parameters: opened(view, key, DocViewTypes::ReturnAndParameters),
    })
}

/// One declared type as the page carries it, or `None` for one **no** function on the arm refers to
/// — which would be a declaration a model could never reach, and which
/// `every_declared_type_is_documented` proves does not exist.
///
/// A type is not a call, so most of an entry's fields are empty on one: it names no operation, has
/// no gate, opens nothing beside itself. That emptiness is the honest shape rather than a set of
/// fields waiting to be filled — a type view is a different kind of block, which is why the two are
/// told apart by [`kind`](GgReferenceEntryKind) rather than by a reader noticing which fields are
/// blank.
fn documented_type(
    views: &[DocsRuntime],
    declaration: &TypeDeclaration,
) -> Option<GgReferenceEntry> {
    let key = declaration.key();
    let module = declaration.module.clone().unwrap_or_default();
    let body = views.iter().find_map(|view| view.read_type(key))?;
    Some(GgReferenceEntry {
        kind: GgReferenceEntryKind::Type,
        fqn: key.to_string(),
        name: declaration.name.clone(),
        category: family_of_module(&module).map(str::to_string),
        module,
        brief: declaration.prose().brief.to_string(),
        body,
        operation: None,
        alias_of: None,
        receiver: None,
        gate: None,
        ending: None,
        capability: None,
        types: Vec::new(),
        returns: Vec::new(),
        opens_under_return: Vec::new(),
        opens_under_return_and_parameters: Vec::new(),
    })
}

/// The [family](crate::skills) one function belongs to, resolved through the
/// [operation](crate::sandbox::operation_of) it binds and falling back to its module's.
///
/// The operation is asked first because it is gg's own identity for the call and carries the family
/// on it, where the grouping an arm filed the call under is *spelling*. The fallback answers for the
/// one thing an operation cannot name — a call gg has no row for — and lands it in its module's
/// family rather than nowhere.
fn category_of(function: &CatalogueFunction) -> Option<String> {
    operation_of(function)
        .map(|operation| operation.family.to_string())
        .or_else(|| {
            family_of_module(function.module.unwrap_or(function.object)).map(str::to_string)
        })
}

/// The type views gg would open beside `key`'s own under `mode`, as the run itself computes them.
///
/// Projected rather than described because the page would otherwise have to explain, in prose, why
/// the transitive [`types`](GgReferenceEntry::types) list beside it is not what a lookup opens. The
/// two really do differ — the closure is not a depth — and stating the depth-one answer is both
/// shorter and checkable.
fn opened(view: &DocsRuntime, key: &str, mode: DocViewTypes) -> Vec<String> {
    view.types_to_open(key, mode)
        .into_iter()
        .map(str::to_string)
        .collect()
}

/// The type keys `references` resolve to, deduplicated and in the order they were referenced.
///
/// A name the arm's own `types` section does not declare has no entry on this page to link to, so it
/// is dropped rather than emitted as a link to nothing; the fully-qualified-name rule holds every arm
/// to declaring what it references, so a drop is drift and
/// `every_referenced_type_resolves_to_a_declaration` fails on it.
fn declared<'a>(
    arm: &'static dyn ProgramLanguage,
    references: impl Iterator<Item = &'a str>,
) -> Vec<String> {
    let mut keys: Vec<String> = Vec::new();
    for reference in references {
        let Some(declaration) = type_declaration(arm, reference) else {
            continue;
        };
        let key = declaration.key().to_string();
        if !keys.contains(&key) {
            keys.push(key);
        }
    }
    keys
}

/// The entries in the order a model meets them: module by module in the arm's own order, each
/// module's callable functions and then the types declared in it.
///
/// A tail catches anything filed under a module the catalogue does not declare. That is unreachable
/// on a well-formed arm — and `every_entry_is_filed_under_a_declared_module` says so — but sorting it
/// out of existence would mean an entry silently disappearing from a page whose payload still
/// carried it, which is the one failure a reader cannot diagnose.
fn ordered(
    modules: &[GgReferenceModule],
    functions: Vec<GgReferenceEntry>,
    types: Vec<GgReferenceEntry>,
) -> Vec<GgReferenceEntry> {
    let declared: BTreeSet<&str> = modules.iter().map(|module| module.id.as_str()).collect();
    let mut entries: Vec<GgReferenceEntry> = Vec::new();
    for module in modules {
        entries.extend(
            functions
                .iter()
                .chain(&types)
                .filter(|entry| entry.module == module.id)
                .cloned(),
        );
    }
    entries.extend(
        functions
            .into_iter()
            .chain(types)
            .filter(|entry| !declared.contains(entry.module.as_str())),
    );
    entries
}

#[cfg(test)]
#[path = "reference.api.test.rs"]
mod tests;
