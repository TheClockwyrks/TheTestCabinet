//! Golden tests: each mirror in `build_rule` against the contracts rule it
//! mirrors, driven over a real build directory.

use super::*;
use std::fs;
use std::path::PathBuf;
use tempfile::TempDir;
use test_cabinet_contracts::layout::{find_build_output, serve_build_file};

/// A build directory holding `files` (path within the build → contents).
fn build_with(files: &[(&str, &[u8])]) -> (TempDir, PathBuf) {
    let dir = TempDir::new().expect("temp dir");
    let build = dir.path().join("dist");
    for (rel, contents) in files {
        let target = build.join(rel);
        fs::create_dir_all(target.parent().unwrap()).expect("create dirs");
        fs::write(target, contents).expect("write file");
    }
    (dir, build)
}

/// HTML documents covering every branch of the relocation: a head with
/// attributes, no head, protocol-relative and scheme URLs, single and double
/// quotes, upper-case tags, multibyte text and a head that never closes.
const DOCUMENTS: [&[u8]; 9] = [
    b"<html><head></head><body></body></html>",
    b"<!doctype html><html><head lang=\"en\">\n<script type=\"module\" src=\"/assets/index-AAA.js\"></script>\
      <link rel=\"stylesheet\" href='/assets/a.css'></head><body><img src=\"/i.png\"></body></html>",
    b"<head></head><body><img src=\"//cdn.example/x.png\"><a href=\"https://example.com\">x</a></body>",
    b"<p><img src=\"/a.png\"></p>",
    b"<HTML><HEAD><SCRIPT SRC=\"/upper.js\"></SCRIPT></HEAD></HTML>",
    "<head><title>caf\u{e9} \u{1f3ae}</title></head><a href=\"/\u{e9}t\u{e9}\">\u{2603}</a>".as_bytes(),
    b"<head",
    b"",
    b"<head><a href=\"/\"></a><a href='//'></a><a href=\"/x/\"></a></head>",
];

#[test]
fn rewrite_html_base_matches_serve_build_file() {
    for (i, document) in DOCUMENTS.iter().enumerate() {
        let (_dir, build) = build_with(&[("index.html", document)]);
        for base in ["/runs/abc/build/", "/artifacts/runs/r-1/build/", "/"] {
            let served = serve_build_file(&build, "index.html", base).expect("served");
            assert_eq!(
                rewrite_html_base(document, base),
                served.body,
                "document {i} under {base}"
            );
        }
    }
    // Non-UTF-8 HTML is served unchanged by both.
    let invalid: &[u8] = &[0xff, 0xfe, b'<', b'h', b'e', b'a', b'd', b'>'];
    let (_dir, build) = build_with(&[("index.html", invalid)]);
    let served = serve_build_file(&build, "", "/b/").expect("served");
    assert_eq!(rewrite_html_base(invalid, "/b/"), served.body);
}

#[test]
fn content_type_for_matches_serve_build_file() {
    let names = [
        "index.html",
        "page.HTM",
        "a.js",
        "m.mjs",
        "s.css",
        "d.json",
        "x.map",
        "g.wasm",
        "i.svg",
        "i.png",
        "i.JPG",
        "i.jpeg",
        "i.gif",
        "i.webp",
        "f.ico",
        "f.woff2",
        "f.woff",
        "f.ttf",
        "f.otf",
        "a.mp3",
        "a.ogg",
        "a.wav",
        "r.txt",
        "data.json.gz",
        ".htaccess",
        "LICENSE",
        "trailing.",
        "x.unknown",
    ];
    let files: Vec<(&str, &[u8])> = names.iter().map(|n| (*n, &b"x"[..])).collect();
    let (_dir, build) = build_with(&files);
    for name in names {
        let served = serve_build_file(&build, name, "/b/").expect("served");
        assert_eq!(content_type_for(name), served.content_type, "{name}");
        // Read by the last segment of a key alone.
        assert_eq!(
            content_type_for(&format!("sub/dir/{name}")),
            served.content_type
        );
    }
}

#[test]
fn normalize_build_path_refuses_what_serve_build_file_refuses() {
    let (dir, build) = build_with(&[("index.html", b"<html></html>"), ("assets/a.js", b"a")]);
    fs::write(dir.path().join("secret"), "nope").unwrap();
    for (path, expected) in [
        ("", Some("")),
        ("/", Some("")),
        ("./", Some("")),
        ("index.html", Some("index.html")),
        ("/assets//./a.js", Some("assets/a.js")),
        ("assets/", Some("assets")),
        ("..", None),
        ("../secret", None),
        ("assets/../index.html", None),
        ("..a/b..", Some("..a/b..")),
    ] {
        assert_eq!(normalize_build_path(path).as_deref(), expected, "{path:?}");
        if expected.is_none() {
            assert_eq!(serve_build_file(&build, path, "/b/"), None, "{path:?}");
        }
    }
    // A normalized path serves what the raw path serves.
    for path in ["/assets//./a.js", "./index.html", ""] {
        let normalized = normalize_build_path(path).unwrap();
        assert_eq!(
            serve_build_file(&build, &normalized, "/b/"),
            serve_build_file(&build, path, "/b/")
        );
    }
}

#[test]
fn find_build_output_in_matches_find_build_output() {
    let sets: [&[&str]; 6] = [
        &[],
        &["out"],
        &["build", "out"],
        &["out", "build", "dist"],
        &["src", "node_modules"],
        &["Dist", "out"],
    ];
    for names in sets {
        let dir = TempDir::new().unwrap();
        for name in names {
            fs::create_dir_all(dir.path().join(name)).unwrap();
        }
        let expected = find_build_output(dir.path());
        let chosen = find_build_output_in(names.iter().copied());
        assert_eq!(chosen.map(|n| dir.path().join(n)), expected, "{names:?}");
    }
}
