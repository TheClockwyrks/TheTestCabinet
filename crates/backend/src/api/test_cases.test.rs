use super::*;

use std::collections::HashMap;

use crate::store::{StoredBuild, StoredCase, StoredErratum, StoredReviewItem, StoredVariant};

/// A minimal end-to-end manifest with two variants (`base` and `extra`), enough to
/// exercise [`version_response`]'s per-variant reference-build fold. The prompt
/// template is literal (no handlebars), so it renders without any seeded specs.
fn manifest() -> StoredManifest {
    let variant = |slug: &str| StoredVariant {
        slug: slug.to_string(),
        name: slug.to_string(),
        description: None,
        specs: vec![],
        workspace: None,
        references: vec![],
        proofs: vec![],
        review_items: vec![],
        domains: vec![],
        voxel: None,
    };
    StoredManifest {
        slug: "carom".to_string(),
        version: "v1.0.1".to_string(),
        name: "Carom".to_string(),
        difficulty: "easy".to_string(),
        tags: vec![],
        summary: None,
        description: None,
        changelog: "Introduced.".to_string(),
        max_runtime_seconds: 1800,
        test_type: TestType::EndToEnd,
        experimental: false,
        build: Some(StoredBuild {
            install: "npm ci".to_string(),
            build: "npm run build".to_string(),
            module: None,
        }),
        canvas: None,
        tool: None,
        output: None,
        contract: None,
        sandbox: None,
        cases: vec![],
        simulation: None,
        r#match: None,
        replay: None,
        asset_kind: AssetKind::Sprite,
        sheet: None,
        voxel: None,
        model: None,
        ui: None,
        material: None,
        particle: None,
        audio: None,
        prompt_template: "build it".to_string(),
        common_specs: vec![],
        workspace: vec![],
        init: None,
        assets: vec![],
        packages: vec![],
        variants: vec![variant("base"), variant("extra")],
        common_references: vec![],
        common_proofs: vec![],
        checks: vec![],
        common_review_items: vec![],
        domains: vec![],
        instrumentation: None,
        errata: Vec::new(),
    }
}

#[test]
fn a_variant_reference_build_url_is_folded_onto_the_matching_variant() {
    // The reference-implementation URLs are read from the database keyed by variant
    // slug, not resolved from the manifest. `version_response` must place a URL on
    // exactly the variant it belongs to and leave a variant absent from the map
    // (here `extra`) as `None`.
    let manifest = manifest();
    let reference_builds = HashMap::from([(
        "base".to_string(),
        "https://carom-v1-0-1-base.test-cabinet-references.pages.dev".to_string(),
    )]);

    let response = version_response(&manifest, &reference_builds, &HashMap::new()).unwrap();

    let base = response.variants.iter().find(|v| v.slug == "base").unwrap();
    assert_eq!(
        base.reference_build.as_deref(),
        Some("https://carom-v1-0-1-base.test-cabinet-references.pages.dev")
    );
    let extra = response
        .variants
        .iter()
        .find(|v| v.slug == "extra")
        .unwrap();
    assert_eq!(extra.reference_build, None);
}

#[test]
fn a_variant_reference_sheet_is_folded_onto_the_matching_variant() {
    // The asset-generation counterpart: the published frame indices are read from the
    // database keyed by variant slug (never resolved from the manifest), so
    // `version_response` must place them on exactly the variant they belong to and
    // leave a variant absent from the map (here `extra`) as `None`. A variant with a
    // reference build and one with a reference sheet are independent — a case is one
    // kind or the other — so this is checked with no builds supplied at all.
    let manifest = manifest();
    let reference_sheets = HashMap::from([("base".to_string(), vec![0, 1, 2])]);

    let response = version_response(&manifest, &HashMap::new(), &reference_sheets).unwrap();

    let base = response.variants.iter().find(|v| v.slug == "base").unwrap();
    assert_eq!(
        base.reference_sheet.as_ref().map(|s| s.frames.as_slice()),
        Some([0, 1, 2].as_slice())
    );
    let extra = response
        .variants
        .iter()
        .find(|v| v.slug == "extra")
        .unwrap();
    assert!(extra.reference_sheet.is_none());

    // The wire key is camelCase and the sheet is an object carrying `frames`, not a
    // bare array — the shape the console and the generated TS binding expect.
    let value = serde_json::to_value(&response).unwrap();
    let base = value["variants"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["slug"] == "base")
        .unwrap();
    assert_eq!(
        base["referenceSheet"]["frames"],
        serde_json::json!([0, 1, 2])
    );
}

#[test]
fn no_reference_sheets_leaves_every_variant_without_one() {
    // The empty-map case (no variant of this version has a published asset reference,
    // or the backend has no R2 configured to have discovered one): every variant
    // resolves to `None` rather than to an empty frame list, so a client can tell
    // "no reference" from "a reference with no frames".
    let response = version_response(&manifest(), &HashMap::new(), &HashMap::new()).unwrap();
    assert!(
        response
            .variants
            .iter()
            .all(|v| v.reference_sheet.is_none())
    );
}

#[test]
fn a_performance_case_scored_set_reaches_the_resolved_version() {
    // The held-out `[[case]]` set must survive into the served VersionResponse and
    // its serialized wire shape, or the driver's `materialize_version` deserializes
    // an empty scored set and every backend-driven performance run aborts with
    // "performance validation requires at least one [[case]]" before scoring.
    // Regression: the DTO carried contract/sandbox but silently dropped `cases`.
    let mut manifest = manifest();
    manifest.test_type = TestType::Performance;
    manifest.cases = vec![
        StoredCase {
            input: "cases/small.json".to_string(),
            expected: "cases/small.out".to_string(),
            fuel_ceiling: 5_000_000_000,
            kind: test_cabinet_core::validation::PerformanceCaseKind::Stress,
        },
        StoredCase {
            input: "cases/large.json".to_string(),
            expected: "cases/large.out".to_string(),
            fuel_ceiling: 5_000_000_000,
            kind: test_cabinet_core::validation::PerformanceCaseKind::Stress,
        },
    ];

    let response = version_response(&manifest, &HashMap::new(), &HashMap::new()).unwrap();
    assert_eq!(response.cases.len(), 2);
    assert_eq!(response.cases[0].input, "cases/small.json");
    assert_eq!(response.cases[0].expected, "cases/small.out");

    // It survives serialization under the `cases` wire key the runner's
    // `VersionBody` deserializes — the actual byte contract to the driver.
    let value = serde_json::to_value(&response).unwrap();
    let cases = value
        .get("cases")
        .and_then(|c| c.as_array())
        .expect("cases is serialized on the wire");
    assert_eq!(cases.len(), 2);
    assert_eq!(cases[0]["input"], "cases/small.json");
    assert_eq!(cases[0]["expected"], "cases/small.out");
    // The runway ceiling must ride the wire under the **camelCase** key the driver's
    // `CaseBody` deserializes. Regression: `CaseOut` lacked `rename_all`, so the
    // first multi-word field (`fuel_ceiling`) went out snake_case and the driver's
    // required `fuelCeiling` was absent — decoding the whole version failed.
    assert_eq!(cases[0]["fuelCeiling"], 5_000_000_000u64);
    assert!(
        cases[0].get("fuel_ceiling").is_none(),
        "the wire key is camelCase, not snake_case"
    );
}

#[test]
fn a_non_performance_version_omits_the_cases_field() {
    // `cases` is skipped when empty, so a non-performance version's wire shape is
    // byte-identical to before this field existed (no `cases` key at all).
    let response = version_response(&manifest(), &HashMap::new(), &HashMap::new()).unwrap();
    assert!(response.cases.is_empty());
    let value = serde_json::to_value(&response).unwrap();
    assert!(
        value.get("cases").is_none(),
        "empty cases is omitted from the wire"
    );
}

#[test]
fn no_reference_builds_leaves_every_variant_without_one() {
    // The empty-map case (no variant of this version has a deployed reference
    // implementation): every variant resolves to `None`.
    let manifest = manifest();
    let response = version_response(&manifest, &HashMap::new(), &HashMap::new()).unwrap();
    assert!(
        response
            .variants
            .iter()
            .all(|v| v.reference_build.is_none())
    );
}

#[test]
fn errata_are_folded_into_the_version_response() {
    // A version's stored errata carry through to the wire response verbatim, so the
    // console's Errata tab and run callout receive them.
    let mut manifest = manifest();
    manifest.errata = vec![StoredErratum {
        id: "cue-clips-rail".to_string(),
        title: "Cue ball clips the rail".to_string(),
        date: Some("2026-07-17".to_string()),
        severity: test_cabinet_core::test_case::ErratumSeverity::Major,
        affects_scoring: true,
        exclude_from_score: false,
        body: "Known tunnelling at high speed.".to_string(),
        resolved_in: Some("v1.1.0".to_string()),
        variant: None,
        review: None,
    }];
    let response = version_response(&manifest, &HashMap::new(), &HashMap::new()).unwrap();
    assert_eq!(response.errata.len(), 1);
    let erratum = &response.errata[0];
    assert_eq!(erratum.id, "cue-clips-rail");
    assert!(erratum.affects_scoring);
    assert_eq!(erratum.resolved_in.as_deref(), Some("v1.1.0"));
}

#[test]
fn a_graded_review_item_carries_its_graded_flag_to_the_wire() {
    // A game-jam category is graded on the five-level scale, and the reviewer editor
    // keys its control (emoji grade scale vs. pass/fail) off each item's `graded`
    // flag. `review_item_out` must copy it, or the live editor renders pass/fail for a
    // game jam. Exercised through a common review item since that path is shared by
    // both common and per-variant items.
    let mut manifest = manifest();
    manifest.test_type = TestType::GameJam;
    manifest.common_review_items = vec![StoredReviewItem {
        id: "fun".to_string(),
        title: "Fun".to_string(),
        text: "How fun is it?".to_string(),
        reference: None,
        proof: None,
        sequences: vec![],
        frames: vec![],
        weight: 1,
        graded: true,
        domain: None,
        sub_items: vec![],
        validation: None,
    }];

    let response = version_response(&manifest, &HashMap::new(), &HashMap::new()).unwrap();

    let item = &response.common_review_items[0];
    assert_eq!(item.id, "fun");
    assert!(item.graded);
}

#[test]
fn a_catalog_entry_carries_the_metadata_a_listing_card_renders() {
    // The whole point of putting metadata on the listing is that a client can
    // render the catalog grid from `GET /test-cases` alone. If any of these
    // fields stops travelling, every console falls back to resolving each case's
    // versions just to draw a card — which is the fan-out this endpoint exists to
    // remove — so each is asserted individually rather than as a blob.
    let mut manifest = manifest();
    manifest.name = "Carom".to_string();
    manifest.difficulty = "easy".to_string();
    manifest.tags = vec!["arcade".to_string(), "physics".to_string()];
    manifest.summary = Some("A duel of angles.".to_string());

    let entry = catalog_case(
        "carom".to_string(),
        vec!["v1.0.0".to_string(), "v1.0.1".to_string()],
        &manifest,
    );

    assert_eq!(entry.slug, "carom");
    assert_eq!(entry.versions, vec!["v1.0.0", "v1.0.1"]);
    assert_eq!(entry.name, "Carom");
    assert_eq!(entry.test_type, TestType::EndToEnd);
    assert_eq!(entry.difficulty, "easy");
    assert_eq!(entry.tags, vec!["arcade", "physics"]);
    assert_eq!(entry.summary.as_deref(), Some("A duel of angles."));
}

#[test]
fn a_catalog_entry_carries_the_asset_shape_the_catalog_tabs_partition_on() {
    // The catalog's 2D / 3D / Particle / Audio tabs are chosen from `assetKind`.
    // It rides on the listing for the same reason the rest of the metadata does:
    // deciding which tab a case belongs under must not require resolving it.
    let mut manifest = manifest();
    manifest.test_type = TestType::AssetGeneration;
    manifest.asset_kind = AssetKind::SpriteSheet;

    let entry = catalog_case("dash".to_string(), vec!["v1.0.0".to_string()], &manifest);

    assert_eq!(entry.test_type, TestType::AssetGeneration);
    assert_eq!(entry.asset_kind, AssetKind::SpriteSheet);
}
