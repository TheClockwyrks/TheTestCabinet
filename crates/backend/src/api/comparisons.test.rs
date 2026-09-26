use super::*;

use std::collections::BTreeMap;

use tempfile::TempDir;
use test_cabinet_core::comparison::{ComparisonArm, ComparisonControls};
use test_cabinet_core::test_case::{AssetDimension, AssetKind, TestType};

use crate::store::{DefinitionStore, StoredBuild, StoredManifest, StoredVariant};

/// The Pi arm of the sample comparison.
fn pi_arm() -> ComparisonArm {
    ComparisonArm {
        id: "pi".into(),
        label: "Pi".into(),
        harness_slug: Some(HarnessSlug::Pi),
        model_id: Some("anthropic/claude-opus-4.8".into()),
        gg_config_id: None,
        gg_slot_models: BTreeMap::new(),
        run_ids: vec![],
    }
}

/// A minimal Pi-vs-Kilo comparison config.
fn sample_config() -> ComparisonConfig {
    ComparisonConfig {
        controls: ComparisonControls {
            case_slug: "carom".into(),
            version: "v2.0.0".into(),
            variant: "base".into(),
            orchestrator_slug: "one-shot".into(),
            engine_slug: "none".into(),
            container_build: None,
        },
        arms: vec![pi_arm(), kilo_arm()],
        n: 3,
    }
}

/// A minimal ingested `carom@v2.0.0`, enough for the engine gate to read its
/// declared support off.
fn carom_manifest() -> StoredManifest {
    StoredManifest {
        toolchain: None,
        engine_format: false,
        slug: "carom".to_string(),
        version: "v2.0.0".to_string(),
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
        asset_dimension: AssetDimension::TwoD,
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
        variants: vec![StoredVariant {
            slug: "base".to_string(),
            name: "Base".to_string(),
            description: None,
            specs: vec![],
            workspace: None,
            references: vec![],
            proofs: vec![],
            review_items: vec![],
            domains: vec![],
            voxel: None,
            showcase: None,
        }],
        common_references: vec![],
        common_proofs: vec![],
        checks: vec![],
        common_review_items: vec![],
        domains: vec![],
        instrumentation: None,
        errata: Vec::new(),
    }
}

/// A save body with the given name.
fn sample_input(name: &str) -> ComparisonInput {
    ComparisonInput {
        name: name.to_string(),
        description: "  Pi vs Kilo on Carom  ".to_string(),
        config: sample_config(),
    }
}

#[test]
fn stored_from_input_trims_and_starts_unpublished() {
    let input = ComparisonInput {
        name: "  carom-pi-vs-kilo  ".to_string(),
        ..sample_input("ignored")
    };
    let stored = stored_from_input(
        "c1".into(),
        "user-1",
        input,
        "2026-07-27T00:00:00Z",
        "2026-07-27T01:00:00Z",
    )
    .unwrap();
    assert_eq!(stored.id, "c1");
    assert_eq!(stored.user_id, "user-1");
    assert_eq!(stored.name, "carom-pi-vs-kilo");
    assert_eq!(stored.description, "Pi vs Kilo on Carom");
    assert_eq!(stored.created_at, "2026-07-27T00:00:00Z");
    assert_eq!(stored.updated_at, "2026-07-27T01:00:00Z");
    assert!(!stored.published);
    assert!(stored.published_at.is_none());
    // The config survives the round trip.
    assert_eq!(stored.config, sample_config());
}

#[test]
fn stored_from_input_rejects_a_blank_name() {
    let input = ComparisonInput {
        name: "   ".to_string(),
        ..sample_input("ignored")
    };
    let err = stored_from_input("c1".into(), "u", input, "t", "t").unwrap_err();
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
}

#[test]
fn stored_from_input_rejects_an_overlong_name() {
    let input = ComparisonInput {
        name: "n".repeat(MAX_NAME_LEN + 1),
        ..sample_input("ignored")
    };
    let err = stored_from_input("c1".into(), "u", input, "t", "t").unwrap_err();
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
}

#[test]
fn stored_from_input_rejects_an_overlong_description() {
    let input = ComparisonInput {
        description: "d".repeat(MAX_DESCRIPTION_LEN + 1),
        ..sample_input("carom")
    };
    let err = stored_from_input("c1".into(), "u", input, "t", "t").unwrap_err();
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
}

/// The stored config serializes to JSON and parses back identically — the shape the
/// `config_json` column round-trips.
#[test]
fn config_json_round_trips() {
    let config = sample_config();
    let json = serde_json::to_string(&config).unwrap();
    let parsed: ComparisonConfig = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed, config);
}

/// A second arm, so `sample_config` clears the two-arm floor.
fn kilo_arm() -> ComparisonArm {
    ComparisonArm {
        id: "kilo".into(),
        label: "Kilo".into(),
        harness_slug: Some(HarnessSlug::Kilo),
        model_id: Some("openrouter/anthropic/claude-opus-4.8".into()),
        gg_config_id: None,
        gg_slot_models: BTreeMap::new(),
        run_ids: vec![],
    }
}

/// A config whose arms are `arms` and whose sample size is `n`.
fn config_of(arms: Vec<ComparisonArm>, n: u32) -> ComparisonConfig {
    ComparisonConfig {
        arms,
        n,
        ..sample_config()
    }
}

/// The bad-request message `validate_config` refuses `config` with.
fn refusal(config: ComparisonConfig) -> String {
    let input = ComparisonInput {
        config,
        ..sample_input("carom")
    };
    let err = stored_from_input("c1".into(), "u", input, "t", "t").unwrap_err();
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
    err.message
}

#[test]
fn stored_from_input_rejects_a_sample_size_outside_the_bounds() {
    assert_eq!(
        refusal(config_of(sample_config().arms, 0)),
        "a comparison runs at least 1 run per arm (got 0)"
    );
    assert_eq!(
        refusal(config_of(sample_config().arms, MAX_N + 1)),
        "a comparison runs at most 50 runs per arm (got 51)"
    );
    // The bounds themselves are accepted.
    for n in [MIN_N, MAX_N] {
        let input = ComparisonInput {
            config: config_of(sample_config().arms, n),
            ..sample_input("carom")
        };
        assert!(stored_from_input("c1".into(), "u", input, "t", "t").is_ok());
    }
}

#[test]
fn stored_from_input_rejects_a_comparison_with_fewer_than_two_arms() {
    assert_eq!(
        refusal(config_of(vec![], 3)),
        "a comparison needs at least 2 arms (got 0)"
    );
    assert_eq!(
        refusal(config_of(vec![pi_arm()], 3)),
        "a comparison needs at least 2 arms (got 1)"
    );
}

#[test]
fn stored_from_input_rejects_two_arms_sharing_an_id() {
    // Two arms under one id share one set of recorded run ids, so neither could be
    // topped up or aggregated on its own.
    let twin = ComparisonArm {
        label: "Pi again".into(),
        ..pi_arm()
    };
    assert_eq!(
        refusal(config_of(vec![pi_arm(), twin], 3)),
        "arm id `pi` is listed twice"
    );
}

#[test]
fn stored_from_input_rejects_a_harness_arm_missing_its_harness_or_model() {
    let nameless = ComparisonArm {
        id: "mystery".into(),
        harness_slug: None,
        model_id: Some("anthropic/claude-opus-4.8".into()),
        ..pi_arm()
    };
    assert_eq!(
        refusal(config_of(vec![kilo_arm(), nameless], 3)),
        "arm `mystery` names neither a harness nor a gg configuration"
    );

    let modelless = ComparisonArm {
        model_id: None,
        ..pi_arm()
    };
    assert_eq!(
        refusal(config_of(vec![kilo_arm(), modelless], 3)),
        "harness arm `pi` names no model"
    );

    // A blank model id is as unlaunchable as an absent one.
    let blank = ComparisonArm {
        model_id: Some("   ".into()),
        ..pi_arm()
    };
    assert_eq!(
        refusal(config_of(vec![kilo_arm(), blank], 3)),
        "harness arm `pi` names no model"
    );
}

#[test]
fn stored_from_input_rejects_a_gg_arm_with_no_configuration() {
    // gg has no launch to make without a capability set, and the arm names none.
    let gg = ComparisonArm {
        id: "gg".into(),
        label: "gg".into(),
        harness_slug: Some(HarnessSlug::Gg),
        model_id: Some("anthropic/claude-opus-4.8".into()),
        gg_config_id: None,
        gg_slot_models: BTreeMap::new(),
        run_ids: vec![],
    };
    assert_eq!(
        refusal(config_of(vec![kilo_arm(), gg], 3)),
        "gg arm `gg` names no configuration"
    );
}

#[test]
fn stored_from_input_accepts_a_gg_arm_beside_a_harness_arm() {
    // A gg arm carries no harness and no model of its own — the configuration binds
    // a model per slot — so the harness-arm rules must not reach it.
    let gg = ComparisonArm {
        id: "gg".into(),
        label: "gg default".into(),
        harness_slug: None,
        model_id: None,
        gg_config_id: Some("builtin:default".into()),
        gg_slot_models: BTreeMap::from([(
            "root".to_string(),
            "anthropic/claude-opus-4.8".to_string(),
        )]),
        run_ids: vec![],
    };
    let input = ComparisonInput {
        config: config_of(vec![pi_arm(), gg], 3),
        ..sample_input("carom")
    };
    assert!(stored_from_input("c1".into(), "u", input, "t", "t").is_ok());
}

/// A store holding one ingested version of `carom` that supports exactly `engines`.
fn store_supporting(engines: &[&str]) -> (TempDir, DefinitionStore) {
    let dir = TempDir::new().expect("temp dir");
    let store = DefinitionStore::open(dir.path()).expect("open store");
    let manifest = StoredManifest {
        engines: engines
            .iter()
            .map(|slug| test_cabinet_core::EngineSupport::unbounded(*slug))
            .collect(),
        ..carom_manifest()
    };
    store.write_manifest(&manifest).expect("write manifest");
    (dir, store)
}

#[test]
fn an_engine_control_the_case_version_supports_is_accepted() {
    let (_dir, store) = store_supporting(&["none", "simple-2d"]);
    let config = ComparisonConfig {
        controls: ComparisonControls {
            engine_slug: "simple-2d".into(),
            ..sample_config().controls
        },
        ..sample_config()
    };
    assert!(ensure_engine_control_supported(&store, &config).is_ok());
}

#[test]
fn an_engine_control_the_case_version_does_not_support_is_refused() {
    // Carom v2.0.0 is engineless-only here, so a comparison anchored to `simple-2d`
    // would score every arm against a checklist written for a runtime the case never
    // declared — and would do it after the runs were paid for.
    let (_dir, store) = store_supporting(&["none"]);
    let config = ComparisonConfig {
        controls: ComparisonControls {
            engine_slug: "simple-2d".into(),
            ..sample_config().controls
        },
        ..sample_config()
    };
    let err = ensure_engine_control_supported(&store, &config).unwrap_err();
    assert_eq!(err.status, StatusCode::BAD_REQUEST);
    assert_eq!(
        err.message,
        "engine `simple-2d` is not supported by test case `carom` v2.0.0 \
         (supported engines: none)"
    );
}

#[test]
fn the_engineless_control_is_held_to_the_declared_set_like_any_other() {
    // A version built against a runtime may leave `none` out, and `none` is what a
    // comparison stored before engine selection existed defaults to — so it is
    // checked rather than waved through.
    let (_dir, store) = store_supporting(&["simple-2d", "simple-3d"]);
    let err = ensure_engine_control_supported(&store, &sample_config()).unwrap_err();
    assert_eq!(
        err.message,
        "engine `none` is not supported by test case `carom` v2.0.0 \
         (supported engines: simple-2d, simple-3d)"
    );
}

#[test]
fn an_unresolvable_case_version_leaves_the_engine_control_unchecked() {
    // The case was de-ingested after the comparison was saved. It still lists and
    // still aggregates (to empty arms), so it must still save — renaming or deleting
    // a stale comparison cannot depend on a manifest that is gone.
    let dir = TempDir::new().expect("temp dir");
    let store = DefinitionStore::open(dir.path()).expect("open store");
    assert!(ensure_engine_control_supported(&store, &sample_config()).is_ok());
}
