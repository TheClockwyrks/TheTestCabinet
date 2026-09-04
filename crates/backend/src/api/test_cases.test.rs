use super::*;

use std::collections::HashMap;

use crate::store::{
    StoredBuild, StoredCase, StoredErratum, StoredReviewItem, StoredShowcase, StoredShowcaseMedia,
    StoredVariant,
};

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
        showcase: None,
    };
    StoredManifest {
        toolchain: None,
        engine_format: false,
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
        engines: vec![test_cabinet_core::EngineSupport::unbounded(
            test_cabinet_core::engine::NONE_SLUG,
        )],
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
        audio_packs: Vec::new(),
        prompt_template: "build it".to_string(),
        common_specs: vec![],
        workspace: Default::default(),
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
    // slug and then by engine, not resolved from the manifest. `version_response`
    // must place them on exactly the variant they belong to, keep the engines apart,
    // and leave a variant absent from the map (here `extra`) empty.
    let manifest = manifest();
    let reference_builds = HashMap::from([(
        "base".to_string(),
        std::collections::BTreeMap::from([
            (
                "none".to_string(),
                "https://carom-v1-0-1-base-none.test-cabinet-references.pages.dev".to_string(),
            ),
            (
                "simple-2d".to_string(),
                "https://carom-v1-0-1-base-simple-2d.test-cabinet-references.pages.dev".to_string(),
            ),
        ]),
    )]);

    let response = version_response(&manifest, &reference_builds, &HashMap::new(), None).unwrap();

    let base = response.variants.iter().find(|v| v.slug == "base").unwrap();
    assert_eq!(
        base.reference_builds.get("none").map(String::as_str),
        Some("https://carom-v1-0-1-base-none.test-cabinet-references.pages.dev")
    );
    assert_eq!(
        base.reference_builds.get("simple-2d").map(String::as_str),
        Some("https://carom-v1-0-1-base-simple-2d.test-cabinet-references.pages.dev")
    );
    let extra = response
        .variants
        .iter()
        .find(|v| v.slug == "extra")
        .unwrap();
    assert!(extra.reference_builds.is_empty());
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

    let response = version_response(&manifest, &HashMap::new(), &reference_sheets, None).unwrap();

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
    let response = version_response(&manifest(), &HashMap::new(), &HashMap::new(), None).unwrap();
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

    let response = version_response(&manifest, &HashMap::new(), &HashMap::new(), None).unwrap();
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
    let response = version_response(&manifest(), &HashMap::new(), &HashMap::new(), None).unwrap();
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
    // implementation): every variant resolves to an empty map.
    let manifest = manifest();
    let response = version_response(&manifest, &HashMap::new(), &HashMap::new(), None).unwrap();
    assert!(
        response
            .variants
            .iter()
            .all(|v| v.reference_builds.is_empty())
    );
}

#[test]
fn the_declared_engines_are_folded_into_the_version_response() {
    // The engines a version supports are the set a launcher offers and the gate the
    // runner holds a selection against, so they have to reach the wire. Both
    // spellings map onto the one table shape: a bare engine carries the slug alone,
    // a pinned one carries its bounds.
    let mut manifest = manifest();
    manifest.engines = vec![
        test_cabinet_core::EngineSupport::unbounded("none"),
        test_cabinet_core::EngineSupport {
            slug: "simple-2d".to_string(),
            min_version: Some("1.0.0".parse().expect("a valid version")),
            max_version: Some("2.0.0".parse().expect("a valid version")),
        },
    ];
    let response = version_response(&manifest, &HashMap::new(), &HashMap::new(), None).unwrap();
    let engines: Vec<&str> = response.engines.iter().map(|e| e.slug.as_str()).collect();
    assert_eq!(engines, vec!["none", "simple-2d"]);
    assert_eq!(response.engines[0].min_version, None);
    assert_eq!(response.engines[0].max_version, None);
    assert_eq!(response.engines[1].min_version.as_deref(), Some("1.0.0"));
    assert_eq!(response.engines[1].max_version.as_deref(), Some("2.0.0"));
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
    let response = version_response(&manifest, &HashMap::new(), &HashMap::new(), None).unwrap();
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
        failure_cap: None,
        domains: vec![],
        sub_items: vec![],
        validation: None,
    }];

    let response = version_response(&manifest, &HashMap::new(), &HashMap::new(), None).unwrap();

    let item = &response.common_review_items[0];
    assert_eq!(item.id, "fun");
    assert!(item.graded);
}

#[test]
fn a_validator_s_engine_scoping_reaches_the_wire_and_an_unscoped_one_is_omitted() {
    // A driver fetching a definition resolves the run's checklist from it, so the
    // engines a validator decides its point on have to survive serialization. The
    // unscoped case serializes nothing at all, which is what a client older than the
    // field reads as "every engine the case supports".
    let mut manifest = manifest();
    let point = |id: &str, engines: &[&str]| StoredReviewItem {
        id: id.to_string(),
        title: id.to_string(),
        text: format!("The build satisfies {id}."),
        reference: None,
        proof: None,
        sequences: vec![],
        frames: vec![],
        weight: 1,
        graded: false,
        domain: None,
        failure_cap: None,
        domains: vec![],
        sub_items: vec![],
        validation: Some(crate::store::StoredReviewValidation {
            script: format!("gameplay/{id}.test.ts"),
            per_engine: true,
            engines: engines.iter().map(|slug| (*slug).to_string()).collect(),
            outputs: vec![],
        }),
    };
    manifest.common_review_items = vec![point("overlay", &["none"]), point("serve", &[])];

    let response = version_response(&manifest, &HashMap::new(), &HashMap::new(), None).unwrap();
    let json = serde_json::to_value(&response).unwrap();
    let items = json["commonReviewItems"].as_array().unwrap();

    assert_eq!(
        items[0]["validation"]["engines"],
        serde_json::json!(["none"])
    );
    assert!(
        items[1]["validation"].get("engines").is_none(),
        "an unscoped validator serializes no `engines` key: {}",
        items[1]["validation"]
    );
}

// ── run-tree artifacts: Accept-Encoding negotiation ──────────────────────────

/// A request carrying one `Accept-Encoding` value (absent when `None`).
fn accept_encoding(value: Option<&str>) -> HeaderMap {
    let mut headers = HeaderMap::new();
    if let Some(value) = value {
        headers.insert(header::ACCEPT_ENCODING, value.parse().unwrap());
    }
    headers
}

/// Gzip `body`, the way an artifact is stored.
fn gzipped(body: &[u8]) -> Vec<u8> {
    use std::io::Write;
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(body).unwrap();
    encoder.finish().unwrap()
}

/// Drain a response into `(status, headers, body)`.
async fn read_response(response: Response) -> (StatusCode, HeaderMap, Vec<u8>) {
    let (parts, body) = response.into_parts();
    let bytes = axum::body::to_bytes(body, usize::MAX).await.unwrap();
    (parts.status, parts.headers, bytes.to_vec())
}

#[tokio::test]
async fn a_browser_receives_a_stored_artifact_gzipped_and_verbatim() {
    // The console advertises gzip, so the stored bytes are moved through untouched —
    // the ~10× the compression bought is only real if it survives the route.
    let stored = gzipped(br#"{"formatVersion":2}"#);
    let response = run_artifact_response(
        &accept_encoding(Some("gzip, deflate, br")),
        "replay",
        stored.clone(),
    )
    .unwrap();
    let (status, headers, body) = read_response(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers[header::CONTENT_ENCODING], "gzip");
    assert_eq!(headers[header::CONTENT_TYPE], "application/json");
    assert_eq!(headers[header::CONTENT_LENGTH], stored.len().to_string());
    assert_eq!(body, stored);
}

#[tokio::test]
async fn a_gzip_unaware_client_receives_the_artifact_decoded() {
    // The workspace `reqwest` is built without its `gzip` feature, so the CLI and the
    // replay driver neither advertise nor decode the encoding. Keying on the stored
    // bytes instead of the request header would hand them a gzip member they cannot
    // parse — this is the whole reason the route negotiates.
    let response =
        run_artifact_response(&accept_encoding(None), "replay", gzipped(br#"{"a":1}"#)).unwrap();
    let (status, headers, body) = read_response(response).await;
    assert_eq!(status, StatusCode::OK);
    assert!(!headers.contains_key(header::CONTENT_ENCODING));
    assert_eq!(headers[header::CONTENT_TYPE], "application/json");
    assert_eq!(body, br#"{"a":1}"#);
    // Content-Length describes the body actually sent, not the stored size.
    assert_eq!(headers[header::CONTENT_LENGTH], body.len().to_string());
}

#[tokio::test]
async fn a_client_that_refuses_gzip_receives_the_artifact_decoded() {
    // `gzip;q=0` is how a client *refuses* an encoding (RFC 9110 §12.5.3); reading it
    // as "gzip appears in the header" would serve exactly what was refused.
    let response = run_artifact_response(
        &accept_encoding(Some("gzip;q=0, identity")),
        "replay",
        gzipped(br#"{"a":1}"#),
    )
    .unwrap();
    let (_, headers, body) = read_response(response).await;
    assert!(!headers.contains_key(header::CONTENT_ENCODING));
    assert_eq!(body, br#"{"a":1}"#);
}

#[tokio::test]
async fn a_plain_json_artifact_is_served_as_is_to_either_client() {
    // Records captured before the convention are stored uncompressed. Neither client
    // may be told they are gzipped, and the route never compresses on demand:
    // compression happens once, where the artifact is written.
    for accepts in [Some("gzip"), None] {
        let response =
            run_artifact_response(&accept_encoding(accepts), "replay", b"{\"v\":1}".to_vec())
                .unwrap();
        let (_, headers, body) = read_response(response).await;
        assert!(!headers.contains_key(header::CONTENT_ENCODING));
        assert_eq!(body, b"{\"v\":1}");
    }
}

#[tokio::test]
async fn a_negotiated_artifact_always_varies_on_accept_encoding() {
    // The body genuinely differs by request header, so a shared cache must not hand a
    // browser's gzipped copy to the gzip-unaware CLI.
    for (accepts, stored) in [
        (Some("gzip"), gzipped(b"{}")),
        (None, gzipped(b"{}")),
        (Some("gzip"), b"{}".to_vec()),
    ] {
        let response = run_artifact_response(&accept_encoding(accepts), "replay", stored).unwrap();
        let (_, headers, _) = read_response(response).await;
        assert_eq!(headers[header::VARY], "accept-encoding");
    }
}

#[tokio::test]
async fn an_artifact_is_served_under_its_own_name() {
    // The name is the one string shared by the store slot, the route segment and the
    // run tree's file stem, so a second artifact needs no second helper.
    let response = run_artifact_response(
        &accept_encoding(Some("gzip")),
        "code-analysis",
        gzipped(b"{}"),
    )
    .unwrap();
    let (status, headers, _) = read_response(response).await;
    assert_eq!(status, StatusCode::OK);
    // Content type is derived from `<name>.json`, and stays JSON even when the body
    // travels gzipped — the encoding is a framing, not a different media type.
    assert_eq!(headers[header::CONTENT_TYPE], "application/json");
}

#[test]
fn accept_encoding_is_read_conservatively() {
    // A wildcard accepts gzip; a refused wildcard does not; an encoding this route
    // cannot produce means "not advertised", whose answer is always plain JSON.
    assert!(accepts_gzip(&accept_encoding(Some("*"))));
    assert!(accepts_gzip(&accept_encoding(Some("GZIP"))));
    assert!(accepts_gzip(&accept_encoding(Some("br, gzip;q=0.5"))));
    assert!(!accepts_gzip(&accept_encoding(Some("*;q=0"))));
    assert!(!accepts_gzip(&accept_encoding(Some("br, deflate"))));
    assert!(!accepts_gzip(&accept_encoding(Some("identity"))));
    assert!(!accepts_gzip(&accept_encoding(None)));
    // A header that is not valid UTF-8 is unreadable, not a reason to fail the route.
    let mut headers = HeaderMap::new();
    headers.insert(
        header::ACCEPT_ENCODING,
        header::HeaderValue::from_bytes(&[0xff, 0xfe]).unwrap(),
    );
    assert!(!accepts_gzip(&headers));
}

#[tokio::test]
async fn a_stored_recording_is_served_as_json_framed_in_gzip() {
    // The baseline and per-run validation routes hand the stored file over under the
    // name it is stored as. A `.json.gz` is a JSON document travelling compressed, so
    // the response says exactly that and the browser inflates it before the replay
    // player sees a byte.
    let stored = gzipped(br#"{"format":1}"#);
    let response = bytes_response("no-tunnel__serve.json.gz", stored.clone());
    let (status, headers, body) = read_response(response).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers[header::CONTENT_TYPE], "application/json");
    assert_eq!(headers[header::CONTENT_ENCODING], "gzip");
    assert_eq!(headers[header::CONTENT_LENGTH], stored.len().to_string());
    assert_eq!(body, stored);
}

#[tokio::test]
async fn a_gzip_archive_is_served_as_the_gzip_document_it_is() {
    // The counterpart case, and the reason the suffix match is compound: here the gzip
    // is the resource. Declaring an encoding would have the client inflate it and keep
    // a bare tar under a `.tar.gz` name.
    let response = bytes_response("run-abc.tar.gz", vec![0x1f, 0x8b, 0x08, 0x00]);
    let (_, headers, _) = read_response(response).await;
    assert_eq!(headers[header::CONTENT_TYPE], "application/gzip");
    assert!(!headers.contains_key(header::CONTENT_ENCODING));
}

#[tokio::test]
async fn an_unframed_case_file_declares_no_encoding() {
    for file in ["prompt.hbs", "spec.md", "reference.png", "controller.wasm"] {
        let (_, headers, _) = read_response(bytes_response(file, vec![1, 2, 3])).await;
        assert!(
            !headers.contains_key(header::CONTENT_ENCODING),
            "`{file}` must not claim a body framing"
        );
    }
}

#[tokio::test]
async fn a_corrupt_stored_artifact_fails_loudly_rather_than_serving_garbage() {
    // Gzip magic with a truncated member: the bytes claim an encoding they cannot
    // honor, so a client that cannot decode gzip must get an error, never a body that
    // is neither JSON nor a valid gzip stream.
    let error = run_artifact_response(&accept_encoding(None), "replay", vec![0x1f, 0x8b, 0x08])
        .expect_err("a truncated gzip member cannot be decoded");
    let (status, _, _) = read_response(error.into_response()).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn the_code_analysis_route_negotiates_exactly_as_the_replay_route_does() {
    // Both run-tree artifacts go through one response helper, deliberately: the
    // convention (gzip on disk, negotiate on the request's `Accept-Encoding`) is only a
    // convention if the second artifact cannot quietly grow its own handler. The Code tab
    // is a browser and gets the stored bytes verbatim; a gzip-unaware client gets them
    // decoded.
    let stored = gzipped(br#"{"analyzerVersion":1}"#);
    let browser = run_artifact_response(
        &accept_encoding(Some("gzip, deflate, br")),
        crate::store::CODE_ANALYSIS_ARTIFACT,
        stored.clone(),
    )
    .unwrap();
    let (status, headers, body) = read_response(browser).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers[header::CONTENT_ENCODING], "gzip");
    assert_eq!(headers[header::CONTENT_TYPE], "application/json");
    assert_eq!(body, stored);

    let cli = run_artifact_response(
        &accept_encoding(None),
        crate::store::CODE_ANALYSIS_ARTIFACT,
        stored,
    )
    .unwrap();
    let (status, headers, body) = read_response(cli).await;
    assert_eq!(status, StatusCode::OK);
    assert!(!headers.contains_key(header::CONTENT_ENCODING));
    assert_eq!(body, br#"{"analyzerVersion":1}"#);
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

/// A one-entry stored showcase for `file`, for the fold/preview tests.
fn stored_showcase(file: &str) -> StoredShowcase {
    StoredShowcase {
        description: "A demo game.".to_string(),
        media: vec![StoredShowcaseMedia {
            file: file.to_string(),
            name: "The title screen".to_string(),
            kind: test_cabinet_core::MediaKind::Image,
            key: format!("showcase/base/{file}"),
        }],
    }
}

#[test]
fn a_variant_showcase_is_folded_onto_the_resolved_version() {
    // A stored showcase must reach the wire on exactly the variant that declares
    // it: description plus the carousel (file, caption, kind) — and nothing else.
    // The store-relative key in particular stays behind: a client fetches the bytes
    // through the showcase route, never by artifact key.
    let mut manifest = manifest();
    manifest.variants[0].showcase = Some(stored_showcase("title.png"));

    let response = version_response(&manifest, &HashMap::new(), &HashMap::new(), None).unwrap();

    let base = response.variants.iter().find(|v| v.slug == "base").unwrap();
    let showcase = base.showcase.as_ref().expect("base carries its showcase");
    assert_eq!(showcase.description, "A demo game.");
    assert_eq!(showcase.media.len(), 1);
    assert_eq!(showcase.media[0].file, "title.png");
    assert_eq!(showcase.media[0].name, "The title screen");
    assert_eq!(showcase.media[0].kind, test_cabinet_core::MediaKind::Image);
    let serialized = serde_json::to_value(&showcase.media[0]).unwrap();
    assert!(
        serialized.get("key").is_none(),
        "the store-relative key must not leak onto the wire",
    );
    // The variant without one exports none.
    let extra = response
        .variants
        .iter()
        .find(|v| v.slug == "extra")
        .unwrap();
    assert!(extra.showcase.is_none());
}

#[test]
fn a_catalog_entry_carries_the_first_showcase_bearing_variants_preview() {
    // The catalog preview comes from the latest version's first variant (manifest
    // order) that declares a showcase — here both do, so `base` wins — addressed by
    // the version and variant the media belongs to.
    let mut manifest = manifest();
    manifest.variants[0].showcase = Some(stored_showcase("title.png"));
    manifest.variants[1].showcase = Some(stored_showcase("other.png"));

    let entry = catalog_case(
        "carom".to_string(),
        vec!["v1.0.0".to_string(), "v1.0.1".to_string()],
        &manifest,
    );

    let showcase = entry.showcase.expect("the listing carries the preview");
    assert_eq!(showcase.version, "v1.0.1");
    assert_eq!(showcase.variant, "base");
    assert_eq!(showcase.media.len(), 1);
    assert_eq!(showcase.media[0].file, "title.png");

    // Declared on the second variant only: manifest order decides, not slug order.
    let mut manifest = self::manifest();
    manifest.variants[1].showcase = Some(stored_showcase("other.png"));
    let entry = catalog_case("carom".to_string(), vec!["v1.0.1".to_string()], &manifest);
    assert_eq!(entry.showcase.unwrap().variant, "extra");

    // No variant declares one: the card renders its placeholder stage.
    let entry = catalog_case(
        "carom".to_string(),
        vec!["v1.0.1".to_string()],
        &self::manifest(),
    );
    assert!(entry.showcase.is_none());
}

/// The prompt template both engine-rendering tests render. A case's real
/// `prompt.hbs` branches on `{{engine.slug}}`; this is the smallest template that
/// makes the branch observable.
fn engine_aware_manifest() -> StoredManifest {
    StoredManifest {
        prompt_template: "Built on {{engine.name}} ({{engine.slug}}).".to_string(),
        engines: vec![
            test_cabinet_core::EngineSupport::unbounded(test_cabinet_core::engine::NONE_SLUG),
            test_cabinet_core::EngineSupport::unbounded("simple-2d"),
        ],
        ..manifest()
    }
}

/// A resolved engine, read from an empty package store: the manifest is baked in,
/// and the staged version a store would supply plays no part in rendering.
fn resolved(slug: &str) -> ResolvedEngine {
    test_cabinet_core::EngineCatalog::with_package_store("/nonexistent")
        .resolve(&EngineSelection::new(slug))
        .unwrap()
}

#[test]
fn a_run_s_engine_renders_that_engine_s_branch_of_the_prompt() {
    // The whole point of the engine on this route: a run's Inputs surface must show
    // the instruction its harness received, and that text depends on the runtime the
    // build was written against.
    let engine = resolved("simple-2d");
    let response = version_response(
        &engine_aware_manifest(),
        &HashMap::new(),
        &HashMap::new(),
        Some(&engine),
    )
    .unwrap();

    let base = response.variants.iter().find(|v| v.slug == "base").unwrap();
    assert_eq!(base.prompt, "Built on Simple 2D (simple-2d).");
}

#[test]
fn no_engine_renders_the_engineless_prompt() {
    // A case gallery renders a case, not a run, so nothing has selected an engine.
    let response = version_response(
        &engine_aware_manifest(),
        &HashMap::new(),
        &HashMap::new(),
        None,
    )
    .unwrap();

    let base = response.variants.iter().find(|v| v.slug == "base").unwrap();
    assert_eq!(base.prompt, "Built on None (none).");
}

#[test]
fn an_explicit_engineless_run_reads_exactly_as_no_engine() {
    // A run that recorded `none` and a surface that named no engine are the same
    // text, so a caller never has to special-case the sentinel to get it right.
    let engine = resolved(test_cabinet_core::engine::NONE_SLUG);
    let manifest = engine_aware_manifest();
    let explicit =
        version_response(&manifest, &HashMap::new(), &HashMap::new(), Some(&engine)).unwrap();
    let absent = version_response(&manifest, &HashMap::new(), &HashMap::new(), None).unwrap();

    assert_eq!(explicit.variants[0].prompt, absent.variants[0].prompt);
}

#[test]
fn an_absent_engine_parameter_resolves_to_the_engineless_rendering() {
    assert!(EngineQuery { engine: None }.resolve().unwrap().is_none());
}

#[test]
fn a_named_engine_resolves_to_that_engine() {
    let resolved = EngineQuery {
        engine: Some("simple-2d".to_string()),
    }
    .resolve()
    .unwrap();

    assert_eq!(
        resolved.as_ref().map(ResolvedEngine::slug),
        Some("simple-2d")
    );
}

#[test]
fn an_unknown_engine_is_refused_rather_than_rendered_engineless() {
    // Falling back to the engineless rendering here would hand a reader text no run
    // ever received, and say nothing about it.
    let error = EngineQuery {
        engine: Some("not-an-engine".to_string()),
    }
    .resolve()
    .expect_err("an unknown engine slug is a client error");

    assert_eq!(error.status, StatusCode::BAD_REQUEST);
}

#[test]
fn a_version_response_carries_the_engine_format_and_each_points_cap_and_domains() {
    use crate::store::StoredSubReviewItem;
    use test_cabinet_core::review::FailureCap;
    let mut manifest = manifest();
    manifest.engine_format = true;
    manifest.common_review_items = vec![
        StoredReviewItem {
            id: "serve".to_string(),
            title: "Serve".to_string(),
            text: "The ball serves.".to_string(),
            reference: None,
            proof: None,
            sequences: vec![],
            frames: vec![],
            weight: 1,
            graded: false,
            domain: None,
            sub_items: vec![],
            validation: None,
            failure_cap: Some(FailureCap::Broken),
            domains: vec!["single-player".to_string()],
        },
        StoredReviewItem {
            id: "hud".to_string(),
            title: "HUD".to_string(),
            text: "The HUD reports state.".to_string(),
            reference: None,
            proof: None,
            sequences: vec![],
            frames: vec![],
            weight: 2,
            graded: false,
            domain: None,
            sub_items: vec![StoredSubReviewItem {
                id: "score".to_string(),
                title: "Score".to_string(),
                description: None,
                weight: 1,
                reference: None,
                proof: None,
                validation: None,
                failure_cap: Some(FailureCap::Great),
                domains: vec!["single-player".to_string(), "versus".to_string()],
            }],
            validation: None,
            failure_cap: None,
            domains: vec![],
        },
    ];

    let response = version_response(&manifest, &HashMap::new(), &HashMap::new(), None).unwrap();
    let json = serde_json::to_value(&response).unwrap();
    assert_eq!(json["engineFormat"], true);
    let items = json["commonReviewItems"].as_array().unwrap();
    assert_eq!(items[0]["failureCap"], "broken");
    assert_eq!(items[0]["domains"], serde_json::json!(["single-player"]));
    // A sub-divided item carries them per sub-item and none of its own.
    assert!(items[1].get("failureCap").is_none());
    assert_eq!(items[1]["domains"], serde_json::json!([]));
    assert_eq!(items[1]["subItems"][0]["failureCap"], "great");
    assert_eq!(
        items[1]["subItems"][0]["domains"],
        serde_json::json!(["single-player", "versus"])
    );

    // A legacy version says so and carries neither key on its items.
    let legacy =
        version_response(&self::manifest(), &HashMap::new(), &HashMap::new(), None).unwrap();
    let json = serde_json::to_value(&legacy).unwrap();
    assert_eq!(json["engineFormat"], false);
}
