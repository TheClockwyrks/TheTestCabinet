//! Tests for harness slug round-trips and usage normalization shape.

use serde_json::json;

use super::*;
use crate::run_record::HarnessSlug;

#[test]
fn every_slug_round_trips_through_its_wire_form() {
    for slug in HarnessSlug::ALL {
        let value = serde_json::to_value(slug).expect("serialize slug");
        assert_eq!(value, json!(slug.as_str()));

        let parsed: HarnessSlug = serde_json::from_value(value).expect("deserialize slug");
        assert_eq!(parsed, slug);
    }
}

#[test]
fn slugs_match_the_documented_catalog() {
    let wire: Vec<&str> = HarnessSlug::ALL.iter().map(|s| s.as_str()).collect();
    assert_eq!(
        wire,
        vec![
            "claude",
            "codex",
            "cline",
            "antigravity",
            "goose",
            "kilo",
            "opencode",
            "pi",
        ]
    );
}

#[test]
fn invocation_serializes_camel_case() {
    let invocation = HarnessInvocation {
        slug: HarnessSlug::Codex,
        model_id: "openai/gpt-x".to_string(),
        prompt: "build the game".to_string(),
    };
    let value = serde_json::to_value(&invocation).expect("serialize");
    assert_eq!(
        value,
        json!({
            "slug": "codex",
            "modelId": "openai/gpt-x",
            "prompt": "build the game"
        })
    );
}

#[test]
fn usage_carries_normalized_token_classes() {
    let usage = Usage {
        tokens: crate::metrics::TokenCounts {
            uncached_input: Some(10),
            cached_input: Some(5),
            output: Some(3),
            reasoning: Some(2),
        },
    };
    let value = serde_json::to_value(usage).expect("serialize");
    assert_eq!(
        value,
        json!({
            "tokens": {
                "uncachedInput": 10,
                "cachedInput": 5,
                "output": 3,
                "reasoning": 2
            }
        })
    );
}

#[test]
fn image_defaults_to_published_namespace_on_latest() {
    // Nothing set: the published GHCR image for the run, on the latest tag.
    // End-to-end runs resolve the base image; single-sprite runs resolve the
    // sprite image (the base plus baked-in `draw`); sprite-sheet runs resolve the
    // sprite-sheet image (the base plus baked-in `draw-sheet`).
    assert_eq!(
        compose_run_image(BASE_IMAGE_NAME, None, None, None),
        "ghcr.io/theclockwyrks/test-cabinet-base:latest"
    );
    assert_eq!(
        compose_run_image(SPRITE_IMAGE_NAME, None, None, None),
        "ghcr.io/theclockwyrks/test-cabinet-sprite:latest"
    );
    assert_eq!(
        compose_run_image(SPRITE_SHEET_IMAGE_NAME, None, None, None),
        "ghcr.io/theclockwyrks/test-cabinet-sprite-sheet:latest"
    );
}

#[test]
fn image_spec_tracks_the_test_type_and_asset_kind() {
    // Each kind of run maps to its own image name AND its own verbatim-override
    // env var; there is no override spanning every image. `asset_kind` is ignored
    // for an end-to-end run.
    let base = image_spec_for(TestType::EndToEnd, AssetKind::Sprite);
    assert_eq!(base.name, BASE_IMAGE_NAME);
    assert_eq!(base.override_env, BASE_IMAGE_OVERRIDE_ENV);

    let sprite = image_spec_for(TestType::AssetGeneration, AssetKind::Sprite);
    assert_eq!(sprite.name, SPRITE_IMAGE_NAME);
    assert_eq!(sprite.override_env, SPRITE_IMAGE_OVERRIDE_ENV);

    let sprite_sheet = image_spec_for(TestType::AssetGeneration, AssetKind::SpriteSheet);
    assert_eq!(sprite_sheet.name, SPRITE_SHEET_IMAGE_NAME);
    assert_eq!(sprite_sheet.override_env, SPRITE_SHEET_IMAGE_OVERRIDE_ENV);

    // The three override env vars are distinct, so pinning one leaves the others
    // resolving from registry/tag.
    assert_ne!(base.override_env, sprite.override_env);
    assert_ne!(sprite.override_env, sprite_sheet.override_env);
    assert_ne!(base.override_env, sprite_sheet.override_env);
}

#[test]
fn image_applies_registry_and_tag_overrides() {
    assert_eq!(
        compose_run_image(
            BASE_IMAGE_NAME,
            None,
            Some("registry.example.com/team".to_string()),
            Some("v2".to_string()),
        ),
        "registry.example.com/team/test-cabinet-base:v2"
    );
    // The same registry/tag carries the sprite and sprite-sheet images too.
    assert_eq!(
        compose_run_image(
            SPRITE_IMAGE_NAME,
            None,
            Some("registry.example.com/team".to_string()),
            Some("v2".to_string()),
        ),
        "registry.example.com/team/test-cabinet-sprite:v2"
    );
    assert_eq!(
        compose_run_image(
            SPRITE_SHEET_IMAGE_NAME,
            None,
            Some("registry.example.com/team".to_string()),
            Some("v2".to_string()),
        ),
        "registry.example.com/team/test-cabinet-sprite-sheet:v2"
    );
    // A trailing slash on the registry is normalized away.
    assert_eq!(
        compose_run_image(
            BASE_IMAGE_NAME,
            None,
            Some("registry.example.com/team/".to_string()),
            None
        ),
        "registry.example.com/team/test-cabinet-base:latest"
    );
}

#[test]
fn image_empty_registry_names_a_local_image() {
    // An explicitly empty registry (distinct from unset) drops the prefix, naming
    // a local image for offline development — for either test type's image.
    assert_eq!(
        compose_run_image(BASE_IMAGE_NAME, None, Some(String::new()), None),
        "test-cabinet-base:latest"
    );
    assert_eq!(
        compose_run_image(SPRITE_IMAGE_NAME, None, Some(String::new()), None),
        "test-cabinet-sprite:latest"
    );
    assert_eq!(
        compose_run_image(SPRITE_SHEET_IMAGE_NAME, None, Some(String::new()), None),
        "test-cabinet-sprite-sheet:latest"
    );
}

#[test]
fn explicit_image_override_wins_verbatim() {
    // The image's own override (`TCAB_CONTAINER_IMAGE_BASE` /
    // `TCAB_CONTAINER_IMAGE_SPRITE` / `TCAB_CONTAINER_IMAGE_SPRITE_SHEET`) takes
    // precedence over registry/tag and is used verbatim (e.g. a pinned digest),
    // trimmed of surrounding whitespace.
    assert_eq!(
        compose_run_image(
            BASE_IMAGE_NAME,
            Some("  ghcr.io/me/custom-base@sha256:abc  ".to_string()),
            Some("registry.example.com".to_string()),
            Some("v9".to_string()),
        ),
        "ghcr.io/me/custom-base@sha256:abc"
    );
    // A blank explicit value is ignored, falling through to the defaults.
    assert_eq!(
        compose_run_image(SPRITE_SHEET_IMAGE_NAME, Some("   ".to_string()), None, None),
        "ghcr.io/theclockwyrks/test-cabinet-sprite-sheet:latest"
    );
}

#[test]
fn run_image_override_envs_is_exhaustive() {
    // RUN_IMAGE_OVERRIDE_ENVS is the set the dispatcher forwards so a full-ref
    // `TCAB_CONTAINER_IMAGE_*` override reaches the driver. It MUST equal exactly the
    // set of override envs `image_spec_for` can return — one per run image. If they
    // drift (a new asset kind whose override is not forwarded), a deployment's
    // per-image pin silently never reaches the run. This test pins them together.

    // Compile-time guard: adding an AssetKind variant makes this match non-exhaustive,
    // so the build breaks HERE, forcing whoever adds the kind to also extend
    // `all_kinds` below and RUN_IMAGE_OVERRIDE_ENVS in `harness.rs`.
    fn _exhaustive(kind: AssetKind) {
        match kind {
            AssetKind::Sprite
            | AssetKind::SpriteSheet
            | AssetKind::VoxelModel
            | AssetKind::VoxelAnimation
            | AssetKind::McModel
            | AssetKind::McAnimation
            | AssetKind::SnModel
            | AssetKind::SnAnimation
            | AssetKind::DcModel
            | AssetKind::DcAnimation
            | AssetKind::Ui
            | AssetKind::Material
            | AssetKind::McSkinned
            | AssetKind::SnSkinned
            | AssetKind::DcSkinned
            | AssetKind::Particle2d
            | AssetKind::Particle3d
            | AssetKind::SfxSynth
            | AssetKind::SfxSample
            | AssetKind::Music
            | AssetKind::BlenderCharacter => {}
        }
    }

    let all_kinds = [
        AssetKind::Sprite,
        AssetKind::SpriteSheet,
        AssetKind::VoxelModel,
        AssetKind::VoxelAnimation,
        AssetKind::McModel,
        AssetKind::McAnimation,
        AssetKind::SnModel,
        AssetKind::SnAnimation,
        AssetKind::DcModel,
        AssetKind::DcAnimation,
        AssetKind::Ui,
        AssetKind::Material,
        AssetKind::McSkinned,
        AssetKind::SnSkinned,
        AssetKind::DcSkinned,
        AssetKind::Particle2d,
        AssetKind::Particle3d,
        AssetKind::SfxSynth,
        AssetKind::SfxSample,
        AssetKind::Music,
        AssetKind::BlenderCharacter,
    ];

    // The complete set of override envs every image can resolve: the three
    // test-type-only images (base for end-to-end, adversarial, performance) plus one
    // per asset kind.
    let mut expected: Vec<&str> = vec![
        image_spec_for(TestType::EndToEnd, AssetKind::Sprite).override_env,
        image_spec_for(TestType::Adversarial, AssetKind::Sprite).override_env,
        image_spec_for(TestType::Performance, AssetKind::Sprite).override_env,
    ];
    expected.extend(
        all_kinds
            .iter()
            .map(|&kind| image_spec_for(TestType::AssetGeneration, kind).override_env),
    );

    // Nothing an image needs is missing from the forwarded set …
    for env in &expected {
        assert!(
            RUN_IMAGE_OVERRIDE_ENVS.contains(env),
            "{env} resolves for some run but is missing from RUN_IMAGE_OVERRIDE_ENVS — \
             the dispatcher would not forward it, so a full-ref override for that image \
             would never reach the driver"
        );
    }
    // … and nothing stale/typo'd is forwarded that no run resolves to.
    for env in RUN_IMAGE_OVERRIDE_ENVS {
        assert!(
            expected.contains(env),
            "{env} is in RUN_IMAGE_OVERRIDE_ENVS but no run resolves to it — stale entry?"
        );
    }

    // Each image contributes exactly one env (no duplicates hiding a mismatch).
    let mut sorted = RUN_IMAGE_OVERRIDE_ENVS.to_vec();
    sorted.sort_unstable();
    let with_dups = sorted.len();
    sorted.dedup();
    assert_eq!(
        with_dups,
        sorted.len(),
        "RUN_IMAGE_OVERRIDE_ENVS contains duplicate entries"
    );
}
