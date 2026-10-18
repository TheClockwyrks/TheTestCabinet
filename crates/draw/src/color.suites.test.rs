//! The manifest check agrees with this parser.
//!
//! A case's `[canvas] background` is refused at resolution by the suites crate's
//! `CanvasBackground::parse`, so that a value this tool would refuse costs a
//! `tcab validate` rather than a run. The two grammars are held together here.

use test_cabinet_suites::color::CanvasBackground;

use super::{Background, Rgba};

#[test]
fn the_manifest_check_accepts_and_refuses_what_the_tool_does() {
    for value in [
        "transparent",
        "Transparent",
        "#000000",
        "#1A2b3C",
        "#1a2b3c80",
        "#FFFFFFFF",
        "1a2b3c",
        "#1a2b3",
        "#1a2b3c8",
        "#1a2b3c8000",
        "#gg0000",
        "",
        "#",
        "white",
        "#12345g",
    ] {
        let tool = Background::parse(value);
        let manifest = CanvasBackground::parse(value);
        match (tool, manifest) {
            (Ok(Background::Transparent), Ok(CanvasBackground::Transparent)) => {}
            (Ok(Background::Color(Rgba(tool))), Ok(CanvasBackground::Color(manifest))) => {
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
