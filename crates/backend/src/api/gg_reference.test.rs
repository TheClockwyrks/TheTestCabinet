use test_cabinet_core::gg_reference::{GgReferenceEntry, GgReferenceLanguage, GgReferenceModule};

use super::*;

/// A minimal index naming `languages` as its arms — the shape `gg reference --out` writes
/// `index.json` in, with the halves this module never looks at (families, tools) left empty.
///
/// Built from the contract types and serialized, rather than written out as JSON by hand:
/// a hand-written fixture would assert this crate's *belief* about the wire shape, and the
/// thing worth asserting is that the very types gg serializes are the types this reads back.
///
/// The counts are deliberately **wrong for the documents beside them** — one module, two
/// functions, three types, whatever the arm really carries — because they are exactly what
/// [`load`] must not serve. A fixture that agreed with its own documents could not tell a
/// recount from a copy.
fn index(languages: &[GgProgramLanguage]) -> String {
    let index = GgReference {
        gg_version: "0.7.0".to_string(),
        categories: Vec::new(),
        tools: Vec::new(),
        languages: languages
            .iter()
            .map(|id| GgReferenceLanguage {
                id: *id,
                module_count: 1,
                function_count: 2,
                type_count: 3,
            })
            .collect(),
    };
    serde_json::to_string(&index).expect("the index fixture serializes")
}

/// One arm's document: one module holding one function and one type, which is the smallest
/// thing that is a *surface* rather than an empty projection.
///
/// It carries entries because the counts the endpoint serves are recounted from here, so a
/// document with nothing in it would make "recounted" and "copied" indistinguishable — and
/// because an arm with no entries is its own failure, asserted separately below.
fn api(language: GgProgramLanguage) -> String {
    let api = GgReferenceApi {
        gg_version: "0.7.0".to_string(),
        language,
        modules: vec![GgReferenceModule {
            id: "files".to_string(),
            path: "gg.files".to_string(),
            summary: "The workspace.".to_string(),
            category: None,
            import: None,
        }],
        entries: vec![
            entry("readFile", GgReferenceEntryKind::Function),
            entry("FileRead", GgReferenceEntryKind::Type),
        ],
    };
    serde_json::to_string(&api).expect("the arm fixture serializes")
}

/// One entry of the fixture arm above, in the module it declares.
fn entry(name: &str, kind: GgReferenceEntryKind) -> GgReferenceEntry {
    GgReferenceEntry {
        kind,
        fqn: format!("gg.files.{name}"),
        name: name.to_string(),
        module: "files".to_string(),
        category: None,
        brief: String::new(),
        body: String::new(),
        operation: None,
        alias_of: None,
        receiver: None,
        ending: None,
        capability: None,
        types: Vec::new(),
        returns: Vec::new(),
        opens_under_return: Vec::new(),
        opens_under_parameters: Vec::new(),
        opens_under_errors: Vec::new(),
    }
}

/// Write a reference directory holding `languages`, listed in the index and present beside
/// it — a faithful miniature of what `gg reference --out` leaves behind.
///
/// The filenames come from `core`'s [`index_file`]/[`document_file`], the same two functions
/// `write_reference` in `test-cabinet-gg` calls and [`load`] reads by. That is deliberate:
/// a fixture that spelled `index.json` here would be a third opinion about the layout, and
/// the third opinion is the one that agrees with the reader and not with the writer.
fn directory(languages: &[GgProgramLanguage]) -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("a scratch directory");
    for language in languages {
        std::fs::write(dir.path().join(document_file(*language)), api(*language))
            .expect("the arm document is written");
    }
    std::fs::write(dir.path().join(index_file()), index(languages))
        .expect("the index document is written");
    dir
}

/// The happy path, and the one property the whole delivery rests on: what gg wrote is what
/// this reads, decoded into the contract types the endpoint promises — not bytes forwarded
/// blind. A field renamed on one side of the generator only shows up here.
#[test]
fn a_directory_written_by_gg_loads_into_the_contract_types() {
    let dir = directory(&[GgProgramLanguage::TypeScript, GgProgramLanguage::Kotlin]);
    let loaded = load(dir.path()).expect("the reference directory loads");

    assert_eq!(loaded.index.languages.len(), 2, "both arms are advertised");
    assert_eq!(loaded.arms.len(), 2, "both arms' documents were read");
    assert_eq!(
        arm(&loaded, "kotlin").expect("kotlin is served").language,
        GgProgramLanguage::Kotlin,
        "an arm is fetched under the id its own document declares"
    );
}

/// **Every count the picker shows was counted here**, off the document this process loaded —
/// not copied out of the index's line about it.
///
/// The fixture's index says one module, two functions and three types for every arm; the
/// documents beside it hold one module, one function and one type. A reader that trusted
/// the file would advertise a size no arm has, and the shape this change introduced is
/// exactly the one that lets those two drift: eleven separate files, read at run time, by a
/// process that is not the one that wrote them.
#[test]
fn the_served_index_reports_the_sizes_of_the_documents_that_were_read() {
    let dir = directory(&[GgProgramLanguage::TypeScript]);
    let loaded = load(dir.path()).expect("the reference directory loads");

    let language = loaded
        .index
        .languages
        .first()
        .expect("one arm is advertised");
    assert_eq!(language.id, GgProgramLanguage::TypeScript);
    assert_eq!(language.module_count, 1, "one module, as the document has");
    assert_eq!(
        language.function_count, 1,
        "one function, not the index's 2"
    );
    assert_eq!(language.type_count, 1, "one type, not the index's 3");
}

/// An arm the index promises and the directory does not hold is **not advertised**, so the
/// picker cannot offer a button whose only answer is a `404`.
///
/// This is the counterpart of the test below, which covers what happens to a reader who asks
/// for it anyway (by an address they kept, or by guessing): they still get the `404` naming
/// what is served. The two together are the whole of "the index describes this deployment".
#[test]
fn an_arm_whose_document_is_missing_is_not_advertised() {
    let dir = directory(&[GgProgramLanguage::TypeScript, GgProgramLanguage::Kotlin]);
    std::fs::remove_file(dir.path().join(document_file(GgProgramLanguage::Kotlin)))
        .expect("kotlin's document is removed");

    let loaded = load(dir.path()).expect("the index still loads");
    let advertised: Vec<GgProgramLanguage> =
        loaded.index.languages.iter().map(|arm| arm.id).collect();
    assert_eq!(
        advertised,
        vec![GgProgramLanguage::TypeScript],
        "only the arm this deployment can serve is listed"
    );
}

/// The failure the move to run-time files introduced, and the reason this module exists at
/// all: nothing is compiled in any more, so an unconfigured deployment has to *say so*.
///
/// The assertion is on the message rather than only the status, because a `503` with no
/// remedy in it is exactly the blank page this design was chosen over. Both the fix and the
/// path that was searched have to be in the body.
#[test]
fn an_absent_directory_is_a_503_that_names_the_fix() {
    let missing = std::path::Path::new("/nonexistent/gg-reference");
    let err = load(missing).expect_err("there is nothing to load");
    let api_error = unavailable(missing, &err);

    assert_eq!(api_error.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(api_error.code, "gg_reference_unavailable");
    assert!(
        api_error.message.contains("scripts/gg-reference.sh"),
        "the message names the script that writes the documents: {}",
        api_error.message
    );
    assert!(
        api_error.message.contains("TCAB_GG_REFERENCE"),
        "the message names the variable that points at them: {}",
        api_error.message
    );
    assert!(
        api_error.message.contains("/nonexistent/gg-reference"),
        "the message names the directory actually searched: {}",
        api_error.message
    );
}

/// An index that is present but not a `GgReference` is the version-skew case: a backend
/// reading documents a differently-versioned gg wrote. It reports as unavailable rather
/// than as a panic on first read, which is what the old embedded artifact did.
#[test]
fn a_malformed_index_is_unavailable_rather_than_a_panic() {
    let dir = tempfile::tempdir().expect("a scratch directory");
    std::fs::write(dir.path().join(index_file()), "{\"ggVersion\":").expect("the index is written");

    let err = load(dir.path()).expect_err("a truncated index does not decode");
    assert!(
        matches!(err, ReferenceError::Malformed { .. }),
        "a present-but-undecodable index is Malformed, not Unreadable: {err}"
    );
    assert_eq!(
        unavailable(dir.path(), &err).status,
        StatusCode::SERVICE_UNAVAILABLE
    );
}

/// One arm's document going missing must cost one arm, never the page — ten working arms
/// replaced by a `503` would be a worse answer than a `404` that says which one is absent.
#[test]
fn an_arm_the_index_lists_but_does_not_ship_costs_only_that_arm() {
    let dir = directory(&[GgProgramLanguage::TypeScript, GgProgramLanguage::Kotlin]);
    std::fs::remove_file(dir.path().join(document_file(GgProgramLanguage::Kotlin)))
        .expect("kotlin's document is removed");

    let loaded = load(dir.path()).expect("the index still loads");
    assert!(
        arm(&loaded, "typescript").is_ok(),
        "the arm that is present is still served"
    );

    let err = arm(&loaded, "kotlin").expect_err("the absent arm is not served");
    assert_eq!(err.status, StatusCode::NOT_FOUND);
    assert!(
        err.message.contains("typescript"),
        "the 404 lists the arms this deployment does serve: {}",
        err.message
    );
}

/// An id that is no program language at all takes the same branch, and for the same reason:
/// from the caller's side "there is no such arm" and "this deployment has not got that arm"
/// are one fact, and the useful half of the answer is the list of arms it *has*.
#[test]
fn an_unknown_language_id_is_a_404_listing_what_is_served() {
    let dir = directory(&[GgProgramLanguage::TypeScript]);
    let loaded = load(dir.path()).expect("the reference directory loads");

    let err = arm(&loaded, "cobol").expect_err("cobol is not a gg arm");
    assert_eq!(err.status, StatusCode::NOT_FOUND);
    assert!(
        err.message.contains("cobol") && err.message.contains("typescript"),
        "the 404 names what was asked for and what is available: {}",
        err.message
    );
}
