//! Unit tests for the shared CLI plumbing: the operation subcommands map to the
//! recorded wire form, the anim config templates per-part paths, `init` / `apply`
//! keep the log and preview in step, and the rig helpers upsert cleanly.

use super::*;
use crate::rig::{Drive, Joint, JointKind, Keyframe, Rig};
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
        parts: vec!["chassis".to_string(), "turret".to_string()],
        actions: default_anim_actions(),
        preview: default_anim_preview(),
        rig: default_rig(),
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
    assert!(config.has_part("chassis"));
    assert!(!config.has_part("barrel"));
}

#[test]
fn apply_appends_to_the_log_and_renders_a_matching_preview() {
    let dir = tempdir();
    let actions = dir.join("actions.json");
    let preview = dir.join("model.png");
    let dims = Dims {
        width: 4,
        height: 4,
        depth: 4,
    };
    let bg = PreviewBackground::Transparent;

    cli_init(&dims, bg, &actions, &preview);
    let (count, returned) = apply(
        &dims,
        bg,
        &actions,
        &preview,
        Operation::SetVoxel {
            x: 1,
            y: 1,
            z: 1,
            color: Rgb([1, 2, 3]),
        },
    )
    .expect("apply");
    assert_eq!(count, 1);

    // The log holds the one operation, and the preview is exactly what that log
    // regenerates to — the property the post-run regeneration relies on. `apply`
    // also returns those same bytes so a live viewer streams the rendered frame.
    let logged = read_actions(&actions).expect("read back");
    assert_eq!(logged.len(), 1);
    let expected = preview_bytes(&render(&dims, &logged), bg);
    let on_disk = std::fs::read(&preview).expect("preview written");
    assert_eq!(on_disk, expected);
    assert_eq!(returned, expected);
}

#[test]
fn render_args_regenerate_a_log_to_a_png() {
    let dir = tempdir();
    let actions = dir.join("log.json");
    let out = dir.join("out.png");
    write_actions(
        &actions,
        &[Operation::SetVoxel {
            x: 0,
            y: 0,
            z: 0,
            color: Rgb([9, 9, 9]),
        }],
    )
    .expect("seed log");
    RenderArgs {
        actions: actions.clone(),
        out: out.clone(),
        width: 2,
        height: 2,
        depth: 2,
        background: "transparent".to_string(),
    }
    .run()
    .expect("render");
    assert!(out.is_file(), "render writes the output png");
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
fn drive_serializes_with_caller_and_auto_tags() {
    let caller = serde_json::to_string(&Drive::Caller).unwrap();
    assert_eq!(caller, "{\"type\":\"caller\"}");
    let auto = serde_json::to_string(&Drive::AutoPlay {
        keyframes: vec![Keyframe {
            t_ms: 0,
            value: 0.0,
        }],
        period_ms: 1000,
        r#loop: true,
    })
    .unwrap();
    assert!(auto.contains("\"type\":\"auto\""), "{auto}");
    assert!(auto.contains("\"periodMs\":1000"), "{auto}");
    assert!(auto.contains("\"looping\":true"), "{auto}");
    assert!(auto.contains("\"tMs\":0"), "{auto}");
}

fn cli_init(dims: &Dims, bg: PreviewBackground, actions: &Path, preview: &Path) {
    init_target(dims, bg, actions, preview).expect("init");
    assert_eq!(read_actions(actions).expect("empty log").len(), 0);
    assert!(preview.is_file(), "init renders a blank preview");
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
