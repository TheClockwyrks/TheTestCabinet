//! The save rules: what decides whether a change to a suite tree can be written
//! at all.
//!
//! [Drafts](https://docs.testcabinet.ai/test-suites/overview/#drafts)
//! is authoritative. A save is refused, and the files on disk left as they were,
//! when the change would:
//!
//! - write to an exported version;
//! - declare an identifier that is not kebab-case, or one that duplicates another
//!   identifier in the same file;
//! - name a path that resolves outside the draft folder.
//!
//! The first is about where a tree sits rather than what it holds, so it is the
//! writer's to enforce. This module checks the other two over a tree's model, and a
//! writer refuses a change whose resulting model carries a save problem the tree did
//! not already carry — a file hand-edited into breaking a rule does not lock every
//! other edit to the draft, and repairing it is still a save like any other.
//!
//! Everything else the format states is an export rule, reported by
//! [`validate_tree`](super::validate_tree) and never refusing a save.

use std::collections::BTreeSet;

use super::partial::PartialSuiteTree;
use super::validation::{SuiteDiagnostic, SuiteEntity, function_address, requirement_address};
use super::version::{DEBUG_API_FILE, SHOWCASE_DIR, VALIDATORS_DIR, VERSION_MANIFEST_FILE};

/// Every save rule the model of `tree` breaks, each addressed to the entity
/// breaking it.
///
/// The rules are about the model alone — a path is judged by where it points, not
/// by what is there — so no tree on disk is needed to decide them.
pub fn save_problems(tree: &PartialSuiteTree) -> Vec<SuiteDiagnostic> {
    let mut problems = Vec::new();
    let mut report = |entity: SuiteEntity, message: String| {
        problems.push(SuiteDiagnostic::save(entity, message));
    };

    if let Some(manifest) = &tree.manifest {
        for declared in [&manifest.description, &manifest.changelog]
            .into_iter()
            .flatten()
        {
            if escapes("", declared) {
                report(SuiteEntity::Suite, outside(VERSION_MANIFEST_FILE, declared));
            }
        }
    }

    for folder in tree.flat_specifications() {
        if let Some(id) = &folder.manifest.id
            && !is_kebab_case(id)
        {
            report(
                folder.entity(),
                format!("specification id `{id}` is not kebab-case"),
            );
        }
        let mut ids = BTreeSet::new();
        for (index, requirement) in folder.manifest.requirements.iter().enumerate() {
            let (entity, prefix) = requirement_address(folder, index, requirement.id.as_deref());
            if let Some(id) = &requirement.id {
                if !is_kebab_case(id) {
                    report(
                        entity.clone(),
                        format!("requirement id `{id}` is not kebab-case"),
                    );
                }
                if !ids.insert(id.clone()) {
                    report(
                        entity.clone(),
                        format!("requirement id `{id}` is declared more than once"),
                    );
                }
            }
            for validator in &requirement.validators {
                if escapes(VALIDATORS_DIR, validator) {
                    report(
                        entity.clone(),
                        format!("{prefix}{}", outside(VALIDATORS_DIR, validator)),
                    );
                }
            }
        }
    }

    if let Some(debug_api) = &tree.debug_api {
        let modules = std::iter::once((DEBUG_API_FILE, &debug_api.root))
            .chain(debug_api.modules.iter().map(|(k, v)| (k.as_str(), v)));
        for (path, module) in modules {
            let entity = SuiteEntity::DebugApiNode(path.to_owned());
            let mut names = BTreeSet::new();
            for (index, function) in module.functions.iter().enumerate() {
                let (function_entity, _) = function_address(path, index, function.name.as_deref());
                if let Some(name) = &function.name
                    && !names.insert(name.clone())
                {
                    report(
                        function_entity.clone(),
                        format!("function name `{name}` is declared more than once"),
                    );
                }
                let mut parameters = BTreeSet::new();
                for name in function
                    .parameters
                    .iter()
                    .filter_map(|parameter| parameter.name.as_ref())
                {
                    if !parameters.insert(name.clone()) {
                        report(
                            function_entity.clone(),
                            format!("parameter name `{name}` is declared more than once"),
                        );
                    }
                }
            }
            let mut children = BTreeSet::new();
            for child in &module.modules {
                if let Some(name) = &child.name
                    && !children.insert(name.clone())
                {
                    report(
                        entity.clone(),
                        format!("module name `{name}` is declared more than once"),
                    );
                }
                if let Some(child_path) = &child.path
                    && escapes("", child_path)
                {
                    report(entity.clone(), outside(path, child_path));
                }
            }
        }
    }

    for case in &tree.test_cases {
        let entity = SuiteEntity::TestCase(case.slug.clone());
        if !is_kebab_case(&case.slug) {
            report(
                entity.clone(),
                format!("test case slug `{}` is not kebab-case", case.slug),
            );
        }
        let definition = &case.definition;
        let declared = definition
            .prompt
            .iter()
            .chain(definition.workspaces.iter().flat_map(|map| map.values()));
        for path in declared {
            if escapes("", path) {
                report(entity.clone(), outside("the definition", path));
            }
        }
    }

    for folder in &tree.assets {
        let entity = folder.entity();
        if let Some(id) = &folder.manifest.id
            && !is_kebab_case(id)
        {
            report(entity.clone(), format!("asset id `{id}` is not kebab-case"));
        }
        for file in folder.manifest.files.iter().flatten() {
            if escapes(&folder.dir, file) {
                report(entity.clone(), outside(&folder.dir, file));
            }
        }
    }

    for folder in &tree.demos {
        if let Some(id) = &folder.manifest.id
            && !is_kebab_case(id)
        {
            report(
                folder.entity(),
                format!("demonstration id `{id}` is not kebab-case"),
            );
        }
    }

    if let Some(showcase) = &tree.showcase {
        for file in showcase
            .manifest
            .media
            .iter()
            .filter_map(|entry| entry.file.as_ref())
        {
            if escapes(SHOWCASE_DIR, file) {
                report(SuiteEntity::Showcase, outside(SHOWCASE_DIR, file));
            }
        }
    }

    problems
}

/// The sentence a path escaping the tree is refused with.
fn outside(declared_in: &str, path: &str) -> String {
    format!("declared path `{path}` in `{declared_in}` resolves outside the suite tree")
}

/// Whether `declared`, taken relative to the tree-relative directory `base`,
/// names a path outside the tree.
///
/// Decided lexically, one segment at a time, because the path may name something
/// that does not exist yet: an absolute path escapes, and so does any `..` that
/// climbs above the tree's root. A `..` that stays inside the tree does not — that
/// a path stays inside the directory it is declared against is an export rule.
pub fn escapes(base: &str, declared: &str) -> bool {
    if declared.starts_with('/') || declared.starts_with('\\') || declared.contains('\0') {
        return true;
    }
    // A drive or scheme prefix names somewhere that is not relative to the tree at
    // all.
    if declared
        .split(['/', '\\'])
        .next()
        .is_some_and(|first| first.contains(':'))
    {
        return true;
    }
    let mut depth: usize = base
        .split('/')
        .filter(|segment| !segment.is_empty() && *segment != ".")
        .count();
    for segment in declared.split(['/', '\\']) {
        match segment {
            "" | "." => {}
            ".." => match depth.checked_sub(1) {
                Some(up) => depth = up,
                None => return true,
            },
            _ => depth += 1,
        }
    }
    false
}

/// Whether an id is kebab-case: a non-empty run of lower-case ASCII letters and
/// digits, optionally separated by single interior hyphens.
pub fn is_kebab_case(id: &str) -> bool {
    !id.is_empty()
        && !id.starts_with('-')
        && !id.ends_with('-')
        && !id.contains("--")
        && id
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
}

#[cfg(test)]
#[path = "save_rules.test.rs"]
mod tests;
