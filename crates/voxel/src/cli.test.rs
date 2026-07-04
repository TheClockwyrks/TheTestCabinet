//! Unit tests for the shared CLI plumbing: the operation subcommands map to the
//! recorded wire form, the anim config templates per-part paths, `init` / `record`
//! keep the log correct (rendering nothing), the on-request `render` writes the
//! preview and mesh, and the rig helpers upsert cleanly.
//!
//! # Render-dependent tests (Vulkan required)
//!
//! Preview rendering now runs through the shared `wgpu` + Mesa **lavapipe** (software
//! Vulkan) renderer, so the tests that write a preview PNG need a Vulkan adapter at
//! runtime — present in the run-container images, absent from a bare dev box or CI
//! runner. Those tests are marked `#[ignore]` so a plain `cargo test --workspace`
//! stays green without a GPU/lavapipe. To run them, install Mesa's lavapipe ICD and
//! opt the ignored tests back in:
//!
//! ```sh
//! # Debian/Ubuntu: the software Vulkan driver + loader.
//! apt-get install -y mesa-vulkan-drivers libvulkan1
//! # Point the loader at lavapipe if it isn't the default adapter, then run them:
//! VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.x86_64.json \
//!   cargo test -p test-cabinet-voxel -- --ignored
//! ```
//!
//! The mesh-generation tests (this crate's `mesh` module and `test-cabinet-voxel-mesh`)
//! need no GPU and are never gated.

use super::*;
use crate::rig::{Drive, Interp, Joint, JointKind, Keyframe, Part, Rig};
use clap::Parser;

/// A minimal parser that flattens [`OpCommand`] so a single operation can be parsed
/// from an argv the way each binary parses it.
#[derive(Parser)]
struct OpOnly {
    #[command(subcommand)]
    op: OpCommand,
}

fn parse_op(args: &[&str]) -> Operation {
    let mut argv = vec!["prog"];
    argv.extend_from_slice(args);
    OpOnly::parse_from(argv).op.into_operation()
}

#[test]
fn fill_box_subcommand_parses_to_the_operation() {
    let op = parse_op(&[
        "fill-box", "--x", "1", "--y", "2", "--z", "3", "--width", "4", "--height", "5", "--depth",
        "6", "--color", "#ff4ec7",
    ]);
    assert_eq!(
        op,
        Operation::FillBox {
            x: 1,
            y: 2,
            z: 3,
            width: 4,
            height: 5,
            depth: 6,
            color: Rgb([0xff, 0x4e, 0xc7]),
        }
    );
}

#[test]
fn mirror_and_sphere_subcommands_parse() {
    assert_eq!(
        parse_op(&["mirror", "--plane", "y", "--at", "16"]),
        Operation::Mirror {
            plane: Axis::Y,
            at: 16,
        }
    );
    assert_eq!(
        parse_op(&[
            "fill-sphere",
            "--cx",
            "20",
            "--cy",
            "16",
            "--cz",
            "8",
            "--r",
            "5",
            "--color",
            "#c46bff",
        ]),
        Operation::FillSphere {
            cx: 20,
            cy: 16,
            cz: 8,
            r: 5,
            color: Rgb([0xc4, 0x6b, 0xff]),
        }
    );
}

#[test]
fn invalid_color_is_rejected_by_the_parser() {
    let result = OpOnly::try_parse_from([
        "prog",
        "set-voxel",
        "--x",
        "0",
        "--y",
        "0",
        "--z",
        "0",
        "--color",
        "red",
    ]);
    assert!(result.is_err(), "a non-hex color must fail to parse");
}

#[test]
fn alpha_color_is_rejected_by_the_parser() {
    let result = OpOnly::try_parse_from([
        "prog",
        "set-voxel",
        "--x",
        "0",
        "--y",
        "0",
        "--z",
        "0",
        "--color",
        "#ff000080",
    ]);
    assert!(result.is_err(), "an alpha color must fail to parse");
}

#[test]
fn anim_config_templates_per_part_paths() {
    let config = AnimConfig {
        width: 32,
        height: 32,
        depth: 32,
        background: "transparent".to_string(),
        actions: "parts/{part}.actions.json".to_string(),
        preview: "parts/{part}.png".to_string(),
        mesh: "parts/{part}.mesh.json".to_string(),
        scene: "scene/{view}.png".to_string(),
        rig: PathBuf::from("rig.json"),
        live: None,
    };
    assert_eq!(
        config.actions_for("turret"),
        PathBuf::from("parts/turret.actions.json")
    );
    assert_eq!(
        config.preview_for("chassis"),
        PathBuf::from("parts/chassis.png")
    );
    assert_eq!(
        config.mesh_for("chassis"),
        PathBuf::from("parts/chassis.mesh.json")
    );
    assert_eq!(config.scene_for("front"), PathBuf::from("scene/front.png"));
}

#[test]
fn declared_parts_and_has_part_read_the_rig() {
    // Parts are model-invented: the config's authoritative part list is whatever the
    // rig (`rig.json`) carries, not a fixed declared set. Before any part exists (no
    // rig file), the list is empty; once the rig names a part, it appears.
    let dir = tempdir();
    let rig_path = dir.join("rig.json");
    let config = AnimConfig {
        width: 8,
        height: 8,
        depth: 8,
        background: "transparent".to_string(),
        actions: "parts/{part}.actions.json".to_string(),
        preview: "parts/{part}.png".to_string(),
        mesh: "parts/{part}.mesh.json".to_string(),
        scene: "scene/{view}.png".to_string(),
        rig: rig_path.clone(),
        live: None,
    };
    // No rig file yet: no parts are defined.
    assert!(config.declared_parts().is_empty());
    assert!(!config.has_part("chassis"));

    // A rig naming `chassis` makes it — and only it — a valid target.
    Rig {
        parts: vec![Part {
            name: "chassis".to_string(),
            parent: None,
            pivot: [0, 0, 0],
        }],
        joints: Vec::new(),
        animations: Vec::new(),
    }
    .save(&rig_path)
    .expect("save rig");
    assert_eq!(config.declared_parts(), vec!["chassis".to_string()]);
    assert!(config.has_part("chassis"));
    assert!(!config.has_part("barrel"));
}

#[test]
fn compose_scene_unions_parts_in_order() {
    let dims = Dims {
        width: 4,
        height: 4,
        depth: 4,
    };
    let base = vec![Operation::FillBox {
        x: 0,
        y: 0,
        z: 0,
        width: 4,
        height: 1,
        depth: 4,
        color: Rgb([1, 1, 1]),
    }];
    // A second part that overlaps one cell of the first — the later part wins there.
    let top = vec![Operation::SetVoxel {
        x: 0,
        y: 0,
        z: 0,
        color: Rgb([9, 9, 9]),
    }];
    let scene = compose_scene(&dims, &[base, top]);
    // 16 floor cells, and the overlapping cell carries the later part's color.
    assert_eq!(scene.occupied_count(), 16);
    assert_eq!(scene.get(0, 0, 0), Some(Rgb([9, 9, 9])));
    assert_eq!(scene.get(3, 0, 3), Some(Rgb([1, 1, 1])));
}

#[test]
#[ignore = "renders PNGs through wgpu + Mesa lavapipe (software Vulkan); needs a Vulkan adapter — run with `cargo test -p test-cabinet-voxel -- --ignored` where lavapipe is installed (see module docs)"]
fn render_scene_writes_every_view() {
    let dir = tempdir();
    let config = AnimConfig {
        width: 6,
        height: 6,
        depth: 6,
        background: "transparent".to_string(),
        actions: dir
            .join("parts/{part}.actions.json")
            .to_string_lossy()
            .into(),
        preview: dir.join("parts/{part}.png").to_string_lossy().into(),
        mesh: dir.join("parts/{part}.mesh.glb").to_string_lossy().into(),
        scene: dir.join("scene/{view}.png").to_string_lossy().into(),
        rig: dir.join("rig.json"),
        live: None,
    };
    // The parts to render come from the produced rig, so declare `chassis` there.
    let mut rig = Rig::new();
    rig.upsert_part("chassis", None);
    rig.save(&config.rig).expect("seed rig");
    write_actions(
        &config.actions_for("chassis"),
        &[Operation::FillBox {
            x: 0,
            y: 0,
            z: 0,
            width: 6,
            height: 1,
            depth: 6,
            color: Rgb([0x5d, 0x6b, 0x3a]),
        }],
    )
    .expect("seed part log");

    render_scene(&config).expect("render scene");
    for (name, _) in SCENE_VIEWS {
        assert!(
            config.scene_for(name).is_file(),
            "scene view {name} is written"
        );
    }
    // The rest-scene render also re-emits each part's `.glb` and preview.
    assert!(config.mesh_for("chassis").is_file(), "part mesh emitted");
    assert!(config.preview_for("chassis").is_file(), "part preview emitted");
}

#[test]
fn record_only_appends_and_renders_nothing() {
    let dir = tempdir();
    let actions = dir.join("actions.json");
    let preview = dir.join("model.png");
    let mesh = dir.join("mesh.glb");

    cli_init(&actions, &preview, &mesh);
    let count = record(
        &actions,
        Operation::SetVoxel {
            x: 1,
            y: 1,
            z: 1,
            color: Rgb([1, 2, 3]),
        },
    )
    .expect("record");
    assert_eq!(count, 1);

    // The log holds the one operation — and recording renders nothing, so no preview
    // and no mesh are written. Rendering is the on-request `render` command's job.
    let logged = read_actions(&actions).expect("read back");
    assert_eq!(logged.len(), 1);
    assert!(!preview.exists(), "recording writes no preview");
    assert!(!mesh.exists(), "recording writes no mesh");
}

#[test]
#[ignore = "renders through wgpu + Mesa lavapipe (software Vulkan); needs a Vulkan adapter — run with `cargo test -p test-cabinet-voxel -- --ignored` where lavapipe is installed (see module docs)"]
fn render_writes_preview_and_glb_from_the_log() {
    let dir = tempdir();
    let config = Config {
        width: 4,
        height: 4,
        depth: 4,
        background: "transparent".to_string(),
        actions: dir.join("actions.json"),
        preview: dir.join("model.png"),
        mesh: dir.join("mesh.glb"),
        live: None,
    };
    write_actions(
        &config.actions,
        &[Operation::SetVoxel {
            x: 1,
            y: 1,
            z: 1,
            color: Rgb([1, 2, 3]),
        }],
    )
    .expect("seed log");

    // On-request render: the returned frame is exactly what lands on disk, so a live
    // viewer streams the same bytes. (Runs through wgpu+Mesa, hence the Vulkan gate.)
    let rendered = RenderArgs {
        view: ViewArg::Iso,
        out: None,
    }
    .run(&config)
    .expect("render");

    let on_disk = std::fs::read(&config.preview).expect("preview written");
    assert_eq!(on_disk, rendered.image);

    // The mesh glb on disk is the returned live body, decoding to the runtime's
    // PartMesh shape (a face-culled surface with one quad → six indices per face).
    let on_disk_mesh = std::fs::read(&config.mesh).expect("mesh written");
    assert_eq!(rendered.live_body, on_disk_mesh);
    assert_eq!(&on_disk_mesh[0..4], b"glTF", "mesh is a glb");
    let arrays =
        test_cabinet_model_core::glb_to_part_mesh(&on_disk_mesh).expect("valid PartMesh glb");
    assert_eq!(
        arrays.indices.len(),
        36,
        "one lone voxel: 6 faces * 6 indices"
    );
    assert_eq!(
        arrays.positions.len(),
        6 * 4 * 3,
        "6 faces * 4 verts * 3 coords"
    );
}

#[test]
fn rig_helpers_upsert_and_round_trip() {
    let mut rig = Rig::new();
    rig.upsert_part("chassis", None);
    rig.upsert_part("turret", Some("chassis".to_string()));
    assert!(rig.set_pivot("turret", [0, 3, 0]));
    assert!(!rig.set_pivot("missing", [0, 0, 0]));
    // Re-upserting the same part updates its parent, not its count.
    rig.upsert_part("turret", Some("chassis".to_string()));
    assert_eq!(rig.parts.len(), 2);

    rig.upsert_joint(Joint {
        name: "turret_yaw".to_string(),
        part: "turret".to_string(),
        kind: JointKind::Rotation,
        axis: Axis::Y,
        pivot: [0, 3, 0],
        min: -1.5,
        max: 1.5,
        rest: 0.0,
        offset: [0.0, 0.0, 0.0],
        orient: [0.0, 0.0, 0.0],
        drive: Drive::Caller,
    });
    assert_eq!(rig.joints.len(), 1);

    let dir = tempdir();
    let path = dir.join("rig.json");
    rig.save(&path).expect("save rig");
    let back = Rig::load(&path).expect("load rig");
    assert_eq!(back, rig);
}

#[test]
fn compound_joint_mount_round_trips_and_omits_zero_default() {
    // A joint with a zero mount omits `offset`/`orient` from the JSON entirely, so
    // existing rigs stay byte-identical; a non-zero mount serializes and round-trips.
    let plain = Joint {
        name: "hinge".to_string(),
        part: "door".to_string(),
        kind: JointKind::Rotation,
        axis: Axis::Y,
        pivot: [0, 0, 0],
        min: 0.0,
        max: 1.0,
        rest: 0.0,
        offset: [0.0, 0.0, 0.0],
        orient: [0.0, 0.0, 0.0],
        drive: Drive::Caller,
    };
    let json = serde_json::to_string(&plain).unwrap();
    assert!(!json.contains("offset"), "zero offset is omitted: {json}");
    assert!(!json.contains("orient"), "zero orient is omitted: {json}");

    let mounted = Joint {
        offset: [2.0, 0.0, -1.5],
        orient: [0.0, std::f64::consts::FRAC_PI_2, 0.0],
        ..plain.clone()
    };
    let json = serde_json::to_string(&mounted).unwrap();
    assert!(json.contains("\"offset\":[2.0,0.0,-1.5]"), "{json}");
    let back: Joint = serde_json::from_str(&json).unwrap();
    assert_eq!(back, mounted);
}

#[test]
fn drive_serializes_as_bare_caller_and_auto() {
    assert_eq!(serde_json::to_string(&Drive::Caller).unwrap(), "\"caller\"");
    assert_eq!(serde_json::to_string(&Drive::Auto).unwrap(), "\"auto\"");
}

#[test]
fn upsert_animation_preserves_tracks_and_add_keyframe_sorts_and_replaces() {
    let mut rig = Rig::new();
    // A new animation declaration, then two keyframes added out of order.
    rig.upsert_animation("walk", 1200, true, false, vec!["hip_l".to_string()]);
    assert!(rig.add_keyframe(
        "walk",
        "hip_l",
        Keyframe {
            t_ms: 1200,
            value: 0.35,
            interp: Interp::Bezier,
            out_handle: None,
            in_handle: None,
        },
    ));
    assert!(rig.add_keyframe(
        "walk",
        "hip_l",
        Keyframe {
            t_ms: 0,
            value: 0.35,
            interp: Interp::EaseIn,
            out_handle: Some([50.0, 0.1]),
            in_handle: None,
        },
    ));
    // A keyframe with the same t_ms replaces in place.
    assert!(rig.add_keyframe(
        "walk",
        "hip_l",
        Keyframe {
            t_ms: 1200,
            value: -0.35,
            interp: Interp::Linear,
            out_handle: None,
            in_handle: None,
        },
    ));
    // add_keyframe on a missing animation reports failure.
    assert!(!rig.add_keyframe(
        "run",
        "hip_l",
        Keyframe {
            t_ms: 0,
            value: 0.0,
            interp: Interp::Linear,
            out_handle: None,
            in_handle: None,
        },
    ));

    let track = &rig.animations[0].tracks[0];
    assert_eq!(track.keyframes.len(), 2, "same-t_ms keyframe replaced");
    assert_eq!(track.keyframes[0].t_ms, 0, "sorted by t_ms");
    assert_eq!(track.keyframes[1].t_ms, 1200);
    assert_eq!(track.keyframes[1].value, -0.35, "replaced in place");

    // Redefining the animation preserves its authored tracks.
    rig.upsert_animation("walk", 800, false, true, vec!["hip_l".to_string()]);
    assert_eq!(rig.animations[0].period_ms, 800);
    assert!(rig.animations[0].auto_play);
    assert_eq!(rig.animations[0].tracks[0].keyframes.len(), 2);

    // The F-curve keyframe serializes with camelCase, kebab-case interp, and omits
    // absent handles.
    let json = serde_json::to_string(&rig.animations[0].tracks[0].keyframes[0]).unwrap();
    assert!(json.contains("\"tMs\":0"), "{json}");
    assert!(json.contains("\"interp\":\"ease-in\""), "{json}");
    assert!(json.contains("\"outHandle\":[50.0,0.1]"), "{json}");
    assert!(
        !json.contains("inHandle"),
        "absent in-handle omitted: {json}"
    );
}

fn cli_init(actions: &Path, preview: &Path, mesh: &Path) {
    init_log(actions).expect("init");
    assert_eq!(read_actions(actions).expect("empty log").len(), 0);
    // `init` records only — it renders nothing, so no preview or mesh yet.
    assert!(!preview.exists(), "init renders no preview");
    assert!(!mesh.exists(), "init writes no mesh");
}

/// A throwaway unique directory under the system temp dir. Avoids a dev-dependency
/// on a temp-file crate for the handful of filesystem round-trips here; the path is
/// derived from the test thread name so concurrent tests never collide.
fn tempdir() -> PathBuf {
    let name = std::thread::current()
        .name()
        .unwrap_or("voxel-cli")
        .replace("::", "-");
    let dir = std::env::temp_dir().join(format!("tcab-voxel-cli-{name}"));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create temp dir");
    dir
}
