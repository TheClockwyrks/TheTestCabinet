use super::*;

use std::collections::HashMap;

use crate::store::{StoredBuild, StoredErratum, StoredVariant};

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

    let response = version_response(&manifest, &reference_builds).unwrap();

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
fn no_reference_builds_leaves_every_variant_without_one() {
    // The empty-map case (no variant of this version has a deployed reference
    // implementation): every variant resolves to `None`.
    let manifest = manifest();
    let response = version_response(&manifest, &HashMap::new()).unwrap();
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
        body: "Known tunnelling at high speed.".to_string(),
        resolved_in: Some("v1.1.0".to_string()),
        variant: None,
        review: None,
    }];
    let response = version_response(&manifest, &HashMap::new()).unwrap();
    assert_eq!(response.errata.len(), 1);
    let erratum = &response.errata[0];
    assert_eq!(erratum.id, "cue-clips-rail");
    assert!(erratum.affects_scoring);
    assert_eq!(erratum.resolved_in.as_deref(), Some("v1.1.0"));
}
