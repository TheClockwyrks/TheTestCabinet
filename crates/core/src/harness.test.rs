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
    // End-to-end runs resolve the base-wasm image (the base plus the shared Rust/wasm
    // toolchain); single-sprite runs resolve the sprite image (the base plus baked-in
    // `draw`); sprite-sheet runs resolve the sprite-sheet image (the base plus baked-in
    // `draw-sheet`).
    assert_eq!(
        compose_run_image(BASE_WASM_IMAGE_NAME, None, None, None),
        "ghcr.io/theclockwyrks/test-cabinet-base-wasm:latest"
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
    assert_eq!(base.name, BASE_WASM_IMAGE_NAME);
    assert_eq!(base.override_env, BASE_WASM_IMAGE_OVERRIDE_ENV);

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
            BASE_WASM_IMAGE_NAME,
            None,
            Some("registry.example.com/team".to_string()),
            Some("v2".to_string()),
        ),
        "registry.example.com/team/test-cabinet-base-wasm:v2"
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
            BASE_WASM_IMAGE_NAME,
            None,
            Some("registry.example.com/team/".to_string()),
            None
        ),
        "registry.example.com/team/test-cabinet-base-wasm:latest"
    );
}

#[test]
fn image_empty_registry_names_a_local_image() {
    // An explicitly empty registry (distinct from unset) drops the prefix, naming
    // a local image for offline development — for either test type's image.
    assert_eq!(
        compose_run_image(BASE_WASM_IMAGE_NAME, None, Some(String::new()), None),
        "test-cabinet-base-wasm:latest"
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
    // The image's own override (`TCAB_CONTAINER_IMAGE_BASE_WASM` /
    // `TCAB_CONTAINER_IMAGE_SPRITE` / `TCAB_CONTAINER_IMAGE_SPRITE_SHEET`) takes
    // precedence over registry/tag and is used verbatim (e.g. a pinned digest),
    // trimmed of surrounding whitespace.
    assert_eq!(
        compose_run_image(
            BASE_WASM_IMAGE_NAME,
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

/// **A gg run resolves the gg variant of its image; every other harness resolves the
/// shared one.**
///
/// The variant carries the language toolchains a responses-as-code program is compiled
/// with. They are gigabytes, they exist for one harness, and a model that found a Swift
/// compiler on `PATH` in a Claude Code run would have been handed a capability no other
/// arm of that comparison has — so the split is the whole point, and it is asserted per
/// harness rather than assumed.
#[test]
fn a_gg_run_resolves_the_gg_variant_of_its_image() {
    for (test_type, plain, gg) in [
        (
            TestType::EndToEnd,
            BASE_WASM_IMAGE_NAME,
            BASE_WASM_GG_IMAGE_NAME,
        ),
        (
            TestType::FullStack,
            FULL_STACK_2D_IMAGE_NAME,
            FULL_STACK_2D_GG_IMAGE_NAME,
        ),
        (
            TestType::GameJam,
            GAME_JAM_IMAGE_NAME,
            GAME_JAM_GG_IMAGE_NAME,
        ),
    ] {
        assert_eq!(
            image_spec_for_run(test_type, AssetKind::Sprite, HarnessSlug::Gg).name,
            gg
        );
        for slug in HarnessSlug::ALL {
            assert_eq!(
                image_spec_for_run(test_type, AssetKind::Sprite, slug).name,
                plain,
                "{slug:?} must not resolve an image carrying gg's toolchains"
            );
        }
    }
}

/// **A gg run whose image has no published variant falls back to the shared image**,
/// rather than resolving a name nothing ever pushed.
///
/// The variant list is deliberately short — publishing one per run image would double the
/// image set and the CI matrix for toolchains most of them would never invoke — and this
/// fallback is what makes a short list safe. The run executes, TypeScript and JavaScript
/// work (their toolchain is inside the gg binary), and a compiled language fails on its
/// first program with the toolchain-missing diagnostic gg already has, which is a named
/// answer rather than an image pull that 404s.
#[test]
fn a_gg_run_without_a_variant_falls_back_to_the_shared_image() {
    let plain = image_spec_for(TestType::AssetGeneration, AssetKind::Sprite);
    assert!(
        gg_variant(&plain).is_none(),
        "this test is about an image with no variant; give it one that has none"
    );
    assert_eq!(
        image_spec_for_run(
            TestType::AssetGeneration,
            AssetKind::Sprite,
            HarnessSlug::Gg
        )
        .name,
        plain.name
    );
    assert_eq!(
        image_spec_for_run(
            TestType::AssetGeneration,
            AssetKind::Sprite,
            HarnessSlug::Gg
        )
        .override_env,
        plain.override_env,
        "the fallback pins on the shared image's override, not on a variant's"
    );
}

/// A gg variant is a **distinct** image with a **distinct** override: sharing either with
/// the image it derives from would mean pinning one pins the other, which is exactly what
/// the per-image override exists to avoid.
#[test]
fn a_gg_variant_shares_neither_its_name_nor_its_override_with_the_image_it_derives_from() {
    for plain in [
        image_spec_for(TestType::EndToEnd, AssetKind::Sprite),
        image_spec_for(TestType::FullStack, AssetKind::Sprite),
        image_spec_for(TestType::GameJam, AssetKind::Sprite),
    ] {
        let variant = gg_variant(&plain).expect("these three publish a gg variant");
        assert_ne!(variant.name, plain.name);
        assert_ne!(variant.override_env, plain.override_env);
        assert_eq!(variant.name, format!("{}-gg", plain.name));
    }
}

/// Every [`AssetKind`], as a list two image tests walk.
///
/// A list rather than a derived constant because `AssetKind` has none; the compile-time
/// `match` in `run_image_override_envs_is_exhaustive` is what stops a new variant reaching
/// either test unnoticed.
fn every_asset_kind() -> [AssetKind; 23] {
    [
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
        AssetKind::BlenderProp,
        AssetKind::BlenderMechanism,
    ]
}

/// **Every image a run can resolve is an image the build actually publishes.**
///
/// `containers/image-names.sh` is the single source of truth for the published set — both
/// `containers/build.sh` and the CI manifest job read it — and this side of the repository
/// is where the names a run *resolves* live. Nothing connected the two, so a name that
/// existed here and not there resolved to a reference no build had ever pushed, and the
/// only symptom was a 404 at pull time on the run that needed it.
///
/// `base` is the one entry that is published and never resolved: it is the build-time
/// parent every other image is `FROM`, not a run image, and it is named as an exception
/// here rather than filtered out silently.
#[test]
fn every_resolvable_image_is_one_the_build_publishes() {
    /// The build-time parent that is published but is not a run image.
    const NOT_A_RUN_IMAGE: &[&str] = &["base"];

    let script = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../containers/image-names.sh")
        .canonicalize()
        .expect("containers/image-names.sh is in the repository");
    let source = std::fs::read_to_string(&script).expect("image-names.sh is readable");
    // The heredoc body is every line that is a bare name: the shebang, the comments, the
    // `set` line and the heredoc delimiters are all excluded by that shape alone.
    let published: Vec<String> = source
        .lines()
        .map(str::trim)
        .filter(|line| {
            !line.is_empty()
                && line
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        })
        .map(|line| format!("test-cabinet-{line}"))
        .collect();

    let mut resolvable: Vec<&str> = vec![
        image_spec_for(TestType::EndToEnd, AssetKind::Sprite).name,
        image_spec_for(TestType::FullStack, AssetKind::Sprite).name,
        image_spec_for(TestType::GameJam, AssetKind::Sprite).name,
        image_spec_for(TestType::Adversarial, AssetKind::Sprite).name,
        image_spec_for(TestType::Performance, AssetKind::Sprite).name,
    ];
    resolvable.extend(
        every_asset_kind()
            .iter()
            .map(|&kind| image_spec_for(TestType::AssetGeneration, kind).name),
    );
    // Each image's gg variant is resolved by a gg run and has to be published too — the
    // newest place the two lists can drift, and the one where the fallback hides nothing:
    // a name here that nothing pushed is a pull that 404s.
    let plain: Vec<ImageSpec> = resolvable
        .iter()
        .map(|&name| ImageSpec {
            name,
            override_env: "",
        })
        .collect();
    let variants: Vec<&str> = plain
        .iter()
        .filter_map(gg_variant)
        .map(|spec| spec.name)
        .collect();

    for name in resolvable.iter().chain(variants.iter()) {
        assert!(
            published.iter().any(|entry| entry == name),
            "{name} is resolved for some run but is not in containers/image-names.sh — no \
             build publishes it, so pulling it would 404"
        );
    }
    for name in &published {
        assert!(
            resolvable.contains(&name.as_str())
                || variants.contains(&name.as_str())
                || NOT_A_RUN_IMAGE
                    .iter()
                    .any(|exception| *name == format!("test-cabinet-{exception}")),
            "{name} is published but no run resolves it — stale entry in image-names.sh?"
        );
    }
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
            | AssetKind::BlenderCharacter
            | AssetKind::BlenderProp
            | AssetKind::BlenderMechanism => {}
        }
    }

    let all_kinds = every_asset_kind();

    // Every image a run can resolve: the five test-type-only ones (base-wasm for
    // end-to-end, full-stack-2d for full-stack, game-jam, adversarial, performance)
    // plus one per asset kind.
    let mut images: Vec<ImageSpec> = vec![
        image_spec_for(TestType::EndToEnd, AssetKind::Sprite),
        image_spec_for(TestType::FullStack, AssetKind::Sprite),
        image_spec_for(TestType::GameJam, AssetKind::Sprite),
        image_spec_for(TestType::Adversarial, AssetKind::Sprite),
        image_spec_for(TestType::Performance, AssetKind::Sprite),
    ];
    images.extend(
        all_kinds
            .iter()
            .map(|&kind| image_spec_for(TestType::AssetGeneration, kind)),
    );
    // …and the gg variant of each image that has one. A gg run resolves a different
    // image with a different build, so it pins on its own override — which has to be
    // forwarded for exactly the reason every other one is.
    let variants: Vec<ImageSpec> = images.iter().filter_map(gg_variant).collect();

    let expected: Vec<&str> = images
        .iter()
        .chain(variants.iter())
        .map(|spec| spec.override_env)
        .collect();

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
