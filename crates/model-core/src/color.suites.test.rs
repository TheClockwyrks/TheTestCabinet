//! The manifest check agrees with this parser.
//!
//! A voxel, material or particle case's preview `background` is refused at
//! resolution by the suites crate's `PreviewBackground::parse`, so that a value
//! this crate would refuse costs a `tcab validate` rather than a run. The two
//! grammars are held together here.

use test_cabinet_suites::color::PreviewBackground as ManifestBackground;

use super::{PreviewBackground, Rgb};

#[test]
fn the_manifest_check_accepts_and_refuses_what_the_tool_does() {
    for value in [
        "transparent",
        "TRANSPARENT",
        "#000000",
        "#1A2b3C",
        "#1a2b3c80",
        "1a2b3c",
        "#fff",
        "#fffffff",
        "#zzzzzz",
        "",
        "#",
        "#12345g",
    ] {
        let tool = PreviewBackground::parse(value);
        let manifest = ManifestBackground::parse(value);
        match (tool, manifest) {
            (Ok(PreviewBackground::Transparent), Ok(ManifestBackground::Transparent)) => {}
            (Ok(PreviewBackground::Color(Rgb(tool))), Ok(ManifestBackground::Color(manifest))) => {
                assert_eq!(tool, manifest, "`{value}` reads as one color");
            }
            (Err(tool), Err(manifest)) => {
                assert_eq!(tool.to_string(), manifest.to_string(), "`{value}`");
            }
            (tool, manifest) => {
                panic!("`{value}`: the tool reads {tool:?}, the check {manifest:?}")
            }
        }
    }
}
