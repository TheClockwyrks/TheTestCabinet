//! Unit tests for the shared CLI plumbing: the operation subcommands map to the
//! recorded wire form, the sheet config templates per-frame paths, and `init` /
//! `apply` keep the log and preview in step.

use super::*;
use clap::Parser;

use crate::{Rgba, render};

/// A minimal parser that flattens [`OpCommand`] so a single operation can be
/// parsed from an argv the way each binary parses it.
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
fn fill_rect_subcommand_parses_to_the_operation() {
    let op = parse_op(&[
        "fill-rect",
        "--x",
        "28",
        "--y",
        "28",
        "--width",
        "8",
        "--height",
        "1",
        "--color",
        "#ff4ec7",
    ]);
    assert_eq!(
        op,
        Operation::FillRect {
            x: 28,
            y: 28,
            width: 8,
            height: 1,
            color: Rgba([0xff, 0x4e, 0xc7, 0xff]),
        }
    );
}

#[test]
fn mirror_and_circle_subcommands_parse() {
    assert_eq!(
        parse_op(&["mirror-horizontal", "--axis-x", "32"]),
        Operation::MirrorHorizontal { axis_x: 32 }
    );
    assert_eq!(
        parse_op(&[
            "fill-circle",
            "--cx",
            "20",
            "--cy",
            "16",
            "--r",
            "8",
            "--color",
            "#c46bff"
        ]),
        Operation::FillCircle {
            cx: 20,
            cy: 16,
            r: 8,
            color: Rgba([0xc4, 0x6b, 0xff, 0xff]),
        }
    );
}

#[test]
fn invalid_color_is_rejected_by_the_parser() {
    let result = OpOnly::try_parse_from([
        "prog",
        "set-pixel",
        "--x",
        "0",
        "--y",
        "0",
        "--color",
        "red",
    ]);
    assert!(result.is_err(), "a non-hex color must fail to parse");
}

#[test]
fn sheet_config_templates_per_frame_paths() {
    let config = SheetConfig {
        width: 32,
        height: 32,
        background: "transparent".to_string(),
        frames: vec![0, 1, 13],
        actions: default_sheet_actions(),
        preview: default_sheet_preview(),
        layers: PathBuf::from("layers.json"),
        live: None,
    };
    assert_eq!(
        config.actions_for(13),
        PathBuf::from("frames/13.actions.json")
    );
    assert_eq!(config.preview_for(0), PathBuf::from("frames/0.png"));
    assert!(config.has_frame(13));
    assert!(!config.has_frame(2));
}

#[test]
fn apply_appends_to_the_log_and_renders_a_matching_preview() {
    let dir = tempdir();
    let actions = dir.join("actions.json");
    let preview = dir.join("canvas.png");
    let canvas = Canvas {
        width: 4,
        height: 4,
        background: Background::Transparent,
    };

    cli_init(&canvas, &actions, &preview);
    let (count, returned) = apply(
        &canvas,
        &actions,
        &preview,
        &Document::new(),
        0,
        Operation::FillBackground {
            color: Rgba([1, 2, 3, 4]),
        },
    )
    .expect("apply");
    assert_eq!(count, 1);

    // The log holds the one operation, and the preview is exactly what that log
    // regenerates to — the property the post-run regeneration relies on. `apply`
    // also returns those same bytes so a live viewer streams the rendered frame.
    let logged = read_actions(&actions).expect("read back");
    assert_eq!(logged.len(), 1);
    let expected = render(&canvas, &logged).to_png_bytes();
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
        &[Operation::SetPixel {
            x: 0,
            y: 0,
            color: Rgba([9, 9, 9, 0xff]),
        }],
    )
    .expect("seed log");
    RenderArgs {
        actions: actions.clone(),
        out: out.clone(),
        width: 2,
        height: 2,
        background: "transparent".to_string(),
        layer_document: None,
    }
    .run(0)
    .expect("render");
    assert!(out.is_file(), "render writes the output png");
}

fn cli_init(canvas: &Canvas, actions: &Path, preview: &Path) {
    init_canvas(canvas, actions, preview).expect("init");
    assert_eq!(read_actions(actions).expect("empty log").len(), 0);
    assert!(preview.is_file(), "init renders a blank preview");
}

/// A throwaway unique directory under the system temp dir. Avoids a dev-dependency
/// on a temp-file crate for the handful of filesystem round-trips here; the path
/// is derived from the test thread name so concurrent tests never collide.
fn tempdir() -> PathBuf {
    let name = std::thread::current()
        .name()
        .unwrap_or("draw-cli")
        .replace("::", "-");
    let dir = std::env::temp_dir().join(format!("tcab-draw-cli-{name}"));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create temp dir");
    dir
}
