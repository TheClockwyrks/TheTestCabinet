//! Unit tests for the validator's image-similarity scoring.

use std::io::BufWriter;

use super::{Image, decode_png, image_similarity, score};

/// A solid image of `value` in every channel.
fn solid(width: usize, height: usize, channels: usize, value: u8) -> Image {
    Image {
        width,
        height,
        channels,
        data: vec![value; width * height * channels],
    }
}

#[test]
fn identical_images_score_one() {
    let a = solid(4, 4, 3, 128);
    let b = solid(4, 4, 3, 128);
    assert_eq!(image_similarity(&a, &b), 1.0);
}

#[test]
fn inverted_images_score_zero() {
    let black = solid(4, 4, 3, 0);
    let white = solid(4, 4, 3, 255);
    assert_eq!(image_similarity(&black, &white), 0.0);
}

#[test]
fn half_difference_scores_about_half() {
    let black = solid(2, 2, 3, 0);
    let gray = solid(2, 2, 3, 128);
    let similarity = image_similarity(&black, &gray);
    // 1 - 128/255 ≈ 0.498.
    assert!((similarity - (1.0 - 128.0 / 255.0)).abs() < 1e-9);
}

#[test]
fn zero_overlap_scores_zero() {
    let empty = solid(0, 4, 3, 255);
    let other = solid(4, 4, 3, 255);
    assert_eq!(image_similarity(&empty, &other), 0.0);
}

#[test]
fn alpha_channel_is_ignored() {
    // Two opaque-vs-transparent reds: identical RGB, differing alpha, scores 1.0.
    let opaque = Image {
        width: 1,
        height: 1,
        channels: 4,
        data: vec![255, 0, 0, 255],
    };
    let transparent = Image {
        width: 1,
        height: 1,
        channels: 4,
        data: vec![255, 0, 0, 0],
    };
    assert_eq!(image_similarity(&opaque, &transparent), 1.0);
}

/// Write an RGBA buffer as an 8-bit PNG.
fn write_png(path: &std::path::Path, width: u32, height: u32, rgba: &[u8]) {
    let file = std::fs::File::create(path).expect("create png");
    let mut encoder = png::Encoder::new(BufWriter::new(file), width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().expect("png header");
    writer.write_image_data(rgba).expect("png data");
}

#[test]
fn decode_png_round_trips_dimensions_and_channels() {
    let dir = tempfile::tempdir().expect("temp dir");
    let path = dir.path().join("solid.png");
    write_png(&path, 3, 2, &[10u8; 3 * 2 * 4]);

    let image = decode_png(&path).expect("decode");
    assert_eq!((image.width, image.height, image.channels), (3, 2, 4));
}

#[test]
fn score_of_identical_pngs_is_one() {
    let dir = tempfile::tempdir().expect("temp dir");
    let baseline = dir.path().join("baseline.png");
    let capture = dir.path().join("capture.png");
    let pixels = vec![64u8; 5 * 5 * 4];
    write_png(&baseline, 5, 5, &pixels);
    write_png(&capture, 5, 5, &pixels);

    assert_eq!(score(&baseline, &capture).expect("score"), 1.0);
}

// --- asset-generation validation -------------------------------------------

use super::AssetGenValidator;
use crate::execution::ArtifactCollection;
use crate::test_case::{
    AssetKind, CanvasSpec, OutputSpec, SheetSequence, SheetSpec, TestCaseVersion, TestType,
    ToolSpec,
};
use crate::validation::Validator;

/// A bare default variant for tests whose validator ignores the variant. Carries
/// no voxel override, so `voxel_for` falls back to the case's `[voxel]`.
fn base_variant() -> crate::test_case::Variant {
    crate::test_case::Variant {
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
    }
}

/// A minimal asset-generation version drawing on a 4x4 transparent canvas.
fn asset_version() -> TestCaseVersion {
    TestCaseVersion {
        slug: "sprite".to_string(),
        version: "v1.0.0".to_string(),
        experimental: false,
        name: "Sprite".to_string(),
        difficulty: "medium".to_string(),
        tags: Vec::new(),
        summary: None,
        description_path: None,
        changelog_path: std::path::PathBuf::new(),
        root: std::path::PathBuf::new(),
        prompt_path: std::path::PathBuf::from("prompt.hbs"),
        max_runtime_seconds: 1800,
        test_type: TestType::AssetGeneration,
        build: None,
        canvas: Some(CanvasSpec {
            width: 4,
            height: 4,
            background: "transparent".to_string(),
        }),
        tool: Some(ToolSpec {
            binary: "draw".to_string(),
            preview: std::path::PathBuf::from("canvas.png"),
        }),
        output: Some(OutputSpec {
            actions: std::path::PathBuf::from("actions.json"),
        }),
        contract: None,
        sandbox: None,
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
        common_specs: Vec::new(),
        common_workspace: Vec::new(),
        init: None,
        asset_paths: Vec::new(),
        packages: Vec::new(),
        variants: Vec::new(),
        common_references: Vec::new(),
        common_proofs: Vec::new(),
        checks: Vec::new(),
        common_review_items: Vec::new(),
        domains: Vec::new(),
        cases: Vec::new(),
    }
}

/// An all-red 4x4 RGBA buffer — what `fill_background #ff0000` regenerates to.
fn red_4x4() -> Vec<u8> {
    [255u8, 0, 0, 255].repeat(16)
}

#[test]
fn asset_validation_regenerates_and_detects_no_cheating() {
    let dir = tempfile::tempdir().expect("temp dir");
    let repo = dir.path().join("impl");
    std::fs::create_dir_all(&repo).expect("repo");
    // The model recorded one operation that fills the canvas red, and left a
    // matching preview on disk (an honest run).
    std::fs::write(
        repo.join("actions.json"),
        r##"[{"op":"fill_background","color":"#ff0000"}]"##,
    )
    .expect("actions");
    write_png(&repo.join("canvas.png"), 4, 4, &red_4x4());

    // An asset-generation run has no target image, so no references are passed.
    let summary = AssetGenValidator::new()
        .validate(
            &asset_version(),
            &base_variant(),
            &ArtifactCollection {
                repo_path: repo.clone(),
            },
            &[],
            &[],
            None,
        )
        .expect("validate");

    assert!(summary.loaded);
    let asset = summary.asset.expect("asset result");
    // A single sprite is one frame (index 0).
    assert_eq!(asset.frames.len(), 1);
    let frame = &asset.frames[0];
    assert_eq!(frame.index, 0);
    assert_eq!(frame.operation_count, 1);
    assert_eq!(
        frame.cheat_divergence,
        Some(0.0),
        "preview matches regeneration"
    );
    assert!(
        repo.join("regenerated.png").is_file(),
        "the regenerated image is written into the tree for serving"
    );
    // A single-sprite case carries no sheet layout.
    assert!(asset.sheet.is_none());
}

#[test]
fn asset_validation_regenerates_each_sheet_frame_independently() {
    let dir = tempfile::tempdir().expect("temp dir");
    let repo = dir.path().join("impl");
    std::fs::create_dir_all(repo.join("frames")).expect("frames dir");
    let red_2x2 = || [255u8, 0, 0, 255].repeat(4);
    // Two declared frames, each with its own recorded log and matching preview.
    for index in [0u32, 1] {
        std::fs::write(
            repo.join(format!("frames/{index}.actions.json")),
            r##"[{"op":"fill_background","color":"#ff0000"}]"##,
        )
        .expect("frame actions");
        write_png(&repo.join(format!("frames/{index}.png")), 2, 2, &red_2x2());
    }

    // The canvas is one frame (2x2); the sheet declares two frames and a sequence.
    let mut version = asset_version();
    version.asset_kind = AssetKind::SpriteSheet;
    version.canvas = Some(CanvasSpec {
        width: 2,
        height: 2,
        background: "transparent".to_string(),
    });
    version.tool = Some(ToolSpec {
        binary: "draw-sheet".to_string(),
        preview: std::path::PathBuf::from("frames/{frame}.png"),
    });
    version.output = Some(OutputSpec {
        actions: std::path::PathBuf::from("frames/{frame}.actions.json"),
    });
    version.sheet = Some(SheetSpec {
        frame_width: 2,
        frame_height: 2,
        frames: vec![0, 1],
        sequences: vec![SheetSequence {
            slug: "walk-right".to_string(),
            name: "Walk Right".to_string(),
            frames: vec![0, 1],
            fps: 4.0,
        }],
    });

    let summary = AssetGenValidator::new()
        .validate(
            &version,
            &base_variant(),
            &ArtifactCollection {
                repo_path: repo.clone(),
            },
            &[],
            &[],
            None,
        )
        .expect("validate");
    let asset = summary.asset.expect("asset result");
    // One result per declared frame, each with its regenerated image written under
    // `regenerated/<index>.png`.
    assert_eq!(asset.frames.len(), 2);
    for (frame, index) in asset.frames.iter().zip([0u32, 1]) {
        assert_eq!(frame.index, index);
        assert_eq!(frame.cheat_divergence, Some(0.0));
        assert!(
            repo.join(format!("regenerated/{index}.png")).is_file(),
            "frame {index} regenerated image is written"
        );
    }
    // The sprite-sheet layout rides into the run record so the review UI can play
    // the named sequences from the per-frame images directly.
    let sheet = asset.sheet.expect("sheet carried into result");
    assert_eq!(sheet.frames, vec![0, 1]);
    assert_eq!(sheet.sequences.len(), 1);
    assert_eq!(sheet.sequences[0].slug, "walk-right");
    assert_eq!(sheet.sequences[0].frames, vec![0, 1]);
}

#[test]
fn asset_validation_flags_drawing_outside_the_tool() {
    let dir = tempfile::tempdir().expect("temp dir");
    let repo = dir.path().join("impl");
    std::fs::create_dir_all(&repo).expect("repo");
    // The log fills red, but the on-disk preview is blue — the model drew outside
    // the recorded operations. Regeneration ignores the preview; divergence flags it.
    std::fs::write(
        repo.join("actions.json"),
        r##"[{"op":"fill_background","color":"#ff0000"}]"##,
    )
    .expect("actions");
    let blue = [0u8, 0, 255, 255].repeat(16);
    write_png(&repo.join("canvas.png"), 4, 4, &blue);

    let summary = AssetGenValidator::new()
        .validate(
            &asset_version(),
            &base_variant(),
            &ArtifactCollection { repo_path: repo },
            &[],
            &[],
            None,
        )
        .expect("validate");

    let asset = summary.asset.expect("asset result");
    let frame = &asset.frames[0];
    let divergence = frame.cheat_divergence.expect("divergence measured");
    assert!(
        divergence > 0.5,
        "blue-vs-red preview diverges strongly: {divergence}"
    );
}

#[test]
fn asset_validation_without_an_action_log_fails_to_load() {
    let dir = tempfile::tempdir().expect("temp dir");
    let repo = dir.path().join("impl");
    std::fs::create_dir_all(&repo).expect("repo");
    let summary = AssetGenValidator::new()
        .validate(
            &asset_version(),
            &base_variant(),
            &ArtifactCollection { repo_path: repo },
            &[],
            &[],
            None,
        )
        .expect("validate");
    assert!(!summary.loaded, "no action log means nothing to score");
    assert!(summary.asset.is_none());
}

// --- dispatch --------------------------------------------------------------

use super::DispatchValidator;
use crate::test_case::{ContractSpec, SandboxSpec, SimulationSpec};

/// A minimal adversarial version rooted at `root`, whose submission module path
/// is `module_rel` (relative to the run root).
fn dispatch_adversarial_version(root: std::path::PathBuf, module_rel: &str) -> TestCaseVersion {
    TestCaseVersion {
        slug: "foray".to_string(),
        version: "v1.0.0".to_string(),
        experimental: false,
        name: "Foray".to_string(),
        difficulty: "hard".to_string(),
        tags: Vec::new(),
        summary: None,
        description_path: None,
        changelog_path: std::path::PathBuf::new(),
        root,
        prompt_path: std::path::PathBuf::from("prompt.hbs"),
        max_runtime_seconds: 1800,
        test_type: TestType::Adversarial,
        build: Some(crate::test_case::BuildCommands {
            install: "cargo fetch".to_string(),
            build: "cargo build".to_string(),
            module: Some(std::path::PathBuf::from(module_rel)),
        }),
        canvas: None,
        tool: None,
        output: None,
        contract: Some(ContractSpec {
            entry: "tick".to_string(),
            world: Some(std::path::PathBuf::from("schemas/world.json")),
            action: Some(std::path::PathBuf::from("schemas/action.json")),
            input: None,
            output: None,
        }),
        sandbox: Some(SandboxSpec {
            fuel_per_tick: Some(5_000_000),
            fuel_limit: None,
            max_memory_bytes: 67_108_864,
        }),
        simulation: Some(SimulationSpec {
            timestep_ms: 16,
            max_ticks: 37_500,
        }),
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
        common_specs: Vec::new(),
        common_workspace: Vec::new(),
        init: None,
        asset_paths: Vec::new(),
        packages: Vec::new(),
        variants: Vec::new(),
        common_references: Vec::new(),
        common_proofs: Vec::new(),
        checks: Vec::new(),
        common_review_items: Vec::new(),
        domains: Vec::new(),
        cases: Vec::new(),
    }
}

#[test]
fn dispatch_routes_an_adversarial_case_to_the_adversarial_validator() {
    let dir = tempfile::tempdir().expect("temp dir");
    let repo = dir.path().join("impl");
    std::fs::create_dir_all(&repo).expect("repo");
    let screenshots = dir.path().join("screenshots");
    // No module on disk → the adversarial validator records a forfeit. The point
    // here is that the dispatcher routed to it at all (it produced an
    // `adversarial` result, not an end-to-end `build`/load failure).
    let version = dispatch_adversarial_version(dir.path().to_path_buf(), "controller.wasm");

    let summary = DispatchValidator::new(screenshots)
        .validate(
            &version,
            &base_variant(),
            &ArtifactCollection { repo_path: repo },
            &[],
            &[],
            None,
        )
        .expect("validate");

    assert!(
        summary.adversarial.is_some(),
        "an adversarial case is scored by the adversarial validator"
    );
    assert!(summary.asset.is_none(), "not an asset-gen result");
    assert!(summary.build.is_none(), "not an end-to-end build result");
}

// --- end-to-end build validation -------------------------------------------

use super::BuildValidator;
use crate::test_case::BuildCommands;
use crate::validation::{ContainerBuild, StepResult};

/// A minimal end-to-end version whose `[build]` commands would be nonsense to run
/// on the host — proving the validator uses the supplied [`ContainerBuild`]
/// outcome rather than shelling out. The command strings are recorded verbatim
/// into the summary, so they double as a marker that the host build never ran.
fn e2e_version() -> TestCaseVersion {
    let mut version = asset_version();
    version.slug = "carom".to_string();
    version.name = "Carom".to_string();
    version.test_type = TestType::EndToEnd;
    version.build = Some(BuildCommands {
        install: "false # would fail on the host".to_string(),
        build: "false # would fail on the host".to_string(),
        module: None,
    });
    version.canvas = None;
    version.tool = None;
    version.output = None;
    version.asset_kind = AssetKind::Sprite;
    version
}

/// The build ran in the container, so the validator folds its recorded outcome in
/// and never shells out on the host. A successful container build over a tree
/// with no `dist/` still fails to load — but on "no build output", not on a host
/// `npm ci` — and both steps are reported as the container recorded them.
#[test]
fn build_validation_uses_the_container_build_and_skips_the_host_build() {
    let dir = tempfile::tempdir().expect("temp dir");
    let repo = dir.path().join("impl");
    std::fs::create_dir_all(&repo).expect("repo");
    // The package.json gate must pass; there is no `dist/`, so the load check that
    // follows a successful build is what fails.
    std::fs::write(repo.join("package.json"), "{}").expect("package.json");

    let container_build = ContainerBuild {
        install: StepResult {
            command: "false # would fail on the host".to_string(),
            succeeded: true,
            detail: None,
        },
        build: Some(StepResult {
            command: "false # would fail on the host".to_string(),
            succeeded: true,
            detail: None,
        }),
    };

    let screenshots = dir.path().join("screenshots");
    let summary = BuildValidator::new(screenshots)
        .validate(
            &e2e_version(),
            &base_variant(),
            &ArtifactCollection { repo_path: repo },
            &[],
            &[],
            Some(&container_build),
        )
        .expect("validate");

    // Both steps are reported as the container recorded them (succeeded), which is
    // impossible if the host `false` command had run.
    assert!(
        summary.install.as_ref().is_some_and(|s| s.succeeded),
        "install taken from the container build"
    );
    assert!(
        summary.build.as_ref().is_some_and(|s| s.succeeded),
        "build taken from the container build"
    );
    // The build succeeded but produced no output tree, so the run did not load.
    assert!(!summary.loaded, "no dist/ means nothing loaded");
    assert!(
        summary
            .detail
            .as_deref()
            .is_some_and(|d| d.contains("dist")),
        "the failure is the missing build output, not a host install: {:?}",
        summary.detail
    );
}

/// A failed container install short-circuits with that recorded outcome: the build
/// step stays unrun and the run does not load, exactly as the host ordering did.
#[test]
fn build_validation_reports_a_failed_container_install() {
    let dir = tempfile::tempdir().expect("temp dir");
    let repo = dir.path().join("impl");
    std::fs::create_dir_all(&repo).expect("repo");
    std::fs::write(repo.join("package.json"), "{}").expect("package.json");

    let container_build = ContainerBuild {
        install: StepResult {
            command: "npm ci".to_string(),
            succeeded: false,
            detail: Some(
                "`npm ci` failed: could not resolve @test-cabinet/particle-runtime".to_string(),
            ),
        },
        build: None,
    };

    let screenshots = dir.path().join("screenshots");
    let summary = BuildValidator::new(screenshots)
        .validate(
            &e2e_version(),
            &base_variant(),
            &ArtifactCollection { repo_path: repo },
            &[],
            &[],
            Some(&container_build),
        )
        .expect("validate");

    assert!(!summary.loaded, "a failed install means nothing loaded");
    assert!(
        summary.install.as_ref().is_some_and(|s| !s.succeeded),
        "the failed install is recorded"
    );
    assert!(
        summary.build.is_none(),
        "the build step is never reached after a failed install"
    );
    assert_eq!(
        summary.detail.as_deref(),
        Some("`npm ci` failed: could not resolve @test-cabinet/particle-runtime"),
        "the container install's failure detail carries through"
    );
}

#[test]
fn skinned_rig_maps_bones_to_parts_keeping_joints_and_animations() {
    // A skinned `rig.json` as `mc-skin`/`sn-skin`/`dc-skin` emit it: a `bones` skeleton
    // (no `parts`), joints that target bones via `part`, and an authored animation.
    let json = r#"{
        "skinned": true,
        "bones": [
            {"name": "pelvis", "head": [8.0, 2.0, 8.0], "tail": [8.0, 6.0, 8.0]},
            {"name": "spine", "parent": "pelvis", "head": [8.4, 6.0, 8.0], "tail": [8.0, 12.0, 8.0]}
        ],
        "joints": [
            {"name": "spine_bend", "part": "spine", "kind": "rotation", "axis": "x",
             "pivot": [8, 6, 8], "min": -1.0, "max": 1.0, "rest": 0.0, "drive": "auto"}
        ],
        "animations": [
            {"name": "idle", "periodMs": 1000, "looping": true, "autoPlay": true,
             "joints": ["spine_bend"],
             "tracks": [{"joint": "spine_bend", "keyframes": [
                {"tMs": 0, "value": 0.0, "interp": "linear"},
                {"tMs": 500, "value": 0.3, "interp": "linear"}
             ]}]}
        ]
    }"#;

    // The parts-based rig cannot parse a skinned rig — the bug the `is_skinned` branch in
    // `read_rig` fixes (it would silently drop the produced joints/animations).
    assert!(
        serde_json::from_str::<test_cabinet_voxel::Rig>(json).is_err(),
        "a bones-based skinned rig must not parse as a parts-based rig"
    );

    let doc: super::SkinnedRigDoc = serde_json::from_str(json).expect("skinned rig parses");
    let spec = super::skinned_rig_to_model_spec(&doc);

    // Each bone becomes a part; a fractional head rounds to the integer voxel grid.
    assert_eq!(spec.parts.len(), 2);
    assert_eq!(spec.parts[0].name, "pelvis");
    assert_eq!(spec.parts[0].pivot, [8, 2, 8]);
    assert_eq!(spec.parts[1].parent.as_deref(), Some("pelvis"));
    assert_eq!(spec.parts[1].pivot, [8, 6, 8], "8.4 rounds to 8");

    // Joints pass through, still targeting their bone; animations pass through intact.
    assert_eq!(spec.joints.len(), 1);
    assert_eq!(spec.joints[0].part, "spine");
    assert_eq!(spec.animations.len(), 1);
    assert!(spec.animations[0].auto_play);
    assert_eq!(spec.animations[0].tracks[0].keyframes.len(), 2);
}
