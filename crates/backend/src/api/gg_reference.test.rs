use std::collections::HashSet;

use super::*;

/// The one thing this crate can get wrong about the reference: shipping bytes that do
/// not decode into the contract type it claims to serve.
///
/// The projection's own invariants (which tools exist, which capability gates each one)
/// are gg's to test — it is the crate that builds them. What the backend owns is the
/// hand-off: an artifact regenerated against a *changed* DTO, or a DTO changed without
/// regenerating, would otherwise be discovered by the first reader of the console page as
/// a 500 from a panicking `OnceLock`.
#[test]
fn the_embedded_artifact_decodes_into_the_contract_type() {
    let reference: GgReference = serde_json::from_str(GG_REFERENCE_JSON)
        .expect("the committed gg reference decodes as GgReference");
    assert!(
        !reference.gg_version.is_empty(),
        "the reference is stamped with the gg version it was projected from"
    );
}

/// A structurally valid but *empty* artifact would decode happily and render a section
/// with nothing in it, so the shape check is not enough on its own. These are floors, not
/// counts: asserting exact totals here would turn every new gg tool into a failing backend
/// test, which is gg's business rather than this crate's.
#[test]
fn the_embedded_artifact_is_populated() {
    let reference = reference();
    assert!(!reference.categories.is_empty(), "families are listed");
    assert!(!reference.tools.is_empty(), "tools are listed");
    assert!(
        !reference.modules.is_empty(),
        "the capability modules the functions are filed under are listed"
    );
    assert!(
        !reference.functions.is_empty(),
        "responses-as-code functions are listed"
    );
}

/// **Every function names a module the same document declares.** The API tab is a folder per module
/// with its functions inside, so a function whose module is not in the list has no folder to sit in
/// and vanishes from the page while remaining in the payload — the exact failure a regenerated
/// artifact against a half-converted arm would produce, and one no reader of the page could
/// diagnose.
#[test]
fn every_function_is_filed_under_a_module_the_document_declares() {
    let reference = reference();
    let declared: HashSet<&str> = reference.modules.iter().map(|m| m.id.as_str()).collect();
    for function in &reference.functions {
        assert!(
            declared.contains(function.module.as_str()),
            "function {}.{} is filed under the module `{}`, which the document does not declare",
            function.module,
            function.name,
            function.module
        );
    }
    for module in &reference.modules {
        assert!(
            !module.path.trim().is_empty() && !module.summary.trim().is_empty(),
            "the module `{}` carries the spelling and the line the page renders it by",
            module.id
        );
    }
}

/// Every tool carries the two things the page exists to show: the prose the model was
/// given, and the JSON Schema it was given alongside it. A tool that lost either would
/// render as a heading with an empty body.
#[test]
fn every_tool_carries_a_description_and_an_object_schema() {
    for tool in &reference().tools {
        assert!(
            !tool.description.trim().is_empty(),
            "{} carries its wire description",
            tool.name
        );
        assert_eq!(
            tool.parameters.get("type").and_then(|t| t.as_str()),
            Some("object"),
            "{}'s parameters are a JSON-Schema object",
            tool.name
        );
        for variant in &tool.variants {
            assert!(
                !variant.description.trim().is_empty(),
                "{}'s {:?} variant carries a description",
                tool.name,
                variant.label
            );
        }
    }
}

/// Every entry resolves to a family the document also carries. The console groups the
/// sidebar by category and would silently drop an entry naming one that is not there —
/// a missing tool is far harder to notice than a broken page.
#[test]
fn every_entry_names_a_category_the_document_defines() {
    let reference = reference();
    let categories: HashSet<&str> = reference.categories.iter().map(|c| c.id.as_str()).collect();
    for tool in &reference.tools {
        assert!(
            categories.contains(tool.category.as_str()),
            "tool {} names the known family {}",
            tool.name,
            tool.category
        );
    }
    for function in &reference.functions {
        assert!(
            categories.contains(function.category.as_str()),
            "function {}.{} names the known family {}",
            function.module,
            function.name,
            function.category
        );
    }
}

/// Every function carries the three things the API tab renders: at least one signature — with
/// a description on every argument it takes — the SDK's own documentation, and the one-line
/// summary the sidebar shows.
#[test]
fn every_function_carries_its_signature_and_docs() {
    for function in &reference().functions {
        assert!(
            !function.signatures.is_empty(),
            "{}.{} carries a signature",
            function.module,
            function.name
        );
        for entry in &function.signatures {
            assert!(
                !entry.signature.trim().is_empty(),
                "{}.{} carries its signature",
                function.module,
                function.name
            );
            for parameter in &entry.parameters {
                assert!(
                    !parameter.doc.trim().is_empty(),
                    "{}.{}'s `{}` carries its description",
                    function.module,
                    function.name,
                    parameter.name
                );
            }
        }
        assert!(
            !function.doc.trim().is_empty(),
            "{}.{} carries its documentation",
            function.module,
            function.name
        );
        assert!(
            !function.summary.trim().is_empty(),
            "{}.{} carries its summary",
            function.module,
            function.name
        );
    }
}
