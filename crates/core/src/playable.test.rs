//! Tests for discovering and serving a run's playable build.

use super::*;
use std::fs;
use tempfile::TempDir;

/// Build a fake implementation directory containing one named build output with
/// the given files (path within the build → contents).
fn impl_with_build(output: &str, files: &[(&str, &str)]) -> TempDir {
    let dir = TempDir::new().expect("temp dir");
    let build = dir.path().join("implementation").join(output);
    for (rel, contents) in files {
        let target = build.join(rel);
        fs::create_dir_all(target.parent().unwrap()).expect("create dirs");
        fs::write(target, contents).expect("write file");
    }
    dir
}

#[test]
fn find_build_output_prefers_dist_then_build_then_out() {
    let dir = impl_with_build("out", &[("index.html", "<html></html>")]);
    let impl_dir = dir.path().join("implementation");
    assert_eq!(find_build_output(&impl_dir), Some(impl_dir.join("out")));

    // `dist` wins when several exist, matching BUILD_OUTPUTS priority.
    fs::create_dir_all(impl_dir.join("build")).unwrap();
    fs::create_dir_all(impl_dir.join("dist")).unwrap();
    assert_eq!(find_build_output(&impl_dir), Some(impl_dir.join("dist")));
}

#[test]
fn find_build_output_is_none_without_a_build() {
    let dir = TempDir::new().unwrap();
    let impl_dir = dir.path().join("implementation");
    fs::create_dir_all(&impl_dir).unwrap();
    assert_eq!(find_build_output(&impl_dir), None);
}

#[test]
fn empty_path_serves_index_html() {
    let dir = impl_with_build("dist", &[("index.html", "<html><head></head></html>")]);
    let build = dir.path().join("implementation").join("dist");
    let served = serve_build_file(&build, "", "/runs/abc/build/").expect("index served");
    assert!(served.content_type.starts_with("text/html"));
    assert!(String::from_utf8(served.body).unwrap().contains("<base"));
}

#[test]
fn html_is_relocated_under_the_base() {
    let html = "<html><head>\n<script type=\"module\" src=\"/assets/index-AAA.js\"></script>\
        </head><body></body></html>";
    let dir = impl_with_build("dist", &[("index.html", html)]);
    let build = dir.path().join("implementation").join("dist");
    let served = serve_build_file(&build, "index.html", "/runs/abc/build/").unwrap();
    let body = String::from_utf8(served.body).unwrap();
    // The base is injected and the absolute asset reference is de-absolutized so
    // the base applies to it.
    assert!(body.contains("<base href=\"/runs/abc/build/\">"));
    assert!(body.contains("src=\"assets/index-AAA.js\""));
    assert!(!body.contains("src=\"/assets/index-AAA.js\""));
}

#[test]
fn protocol_relative_and_scheme_urls_are_left_alone() {
    let html = "<head></head><body>\
        <img src=\"//cdn.example/x.png\"><a href=\"https://example.com\">x</a></body>";
    let dir = impl_with_build("dist", &[("index.html", html)]);
    let build = dir.path().join("implementation").join("dist");
    let body = serve_build_file(&build, "", "/b/").unwrap().body;
    let body = String::from_utf8(body).unwrap();
    assert!(body.contains("src=\"//cdn.example/x.png\""));
    assert!(body.contains("href=\"https://example.com\""));
}

#[test]
fn non_html_assets_are_served_verbatim_with_a_mime_type() {
    let dir = impl_with_build(
        "dist",
        &[("assets/index-AAA.js", "console.log('/not/rewritten')")],
    );
    let build = dir.path().join("implementation").join("dist");
    let served = serve_build_file(&build, "assets/index-AAA.js", "/b/").unwrap();
    assert!(served.content_type.starts_with("text/javascript"));
    // JS is byte-for-byte: an absolute path in a string literal is not touched.
    assert_eq!(served.body, b"console.log('/not/rewritten')");
}

#[test]
fn traversal_outside_the_build_is_refused() {
    let dir = impl_with_build("dist", &[("index.html", "<html></html>")]);
    // A secret beside (not inside) the build.
    fs::write(dir.path().join("implementation").join("secret"), "nope").unwrap();
    let build = dir.path().join("implementation").join("dist");
    assert_eq!(serve_build_file(&build, "../secret", "/b/"), None);
}

#[test]
fn missing_file_is_none() {
    let dir = impl_with_build("dist", &[("index.html", "<html></html>")]);
    let build = dir.path().join("implementation").join("dist");
    assert_eq!(serve_build_file(&build, "does-not-exist.js", "/b/"), None);
}
