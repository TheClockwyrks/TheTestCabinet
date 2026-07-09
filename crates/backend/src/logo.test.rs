use super::*;

#[test]
fn allows_only_svgl_https_urls() {
    assert!(is_allowed_url("https://svgl.app/library/anthropic.svg"));
    assert!(is_allowed_url("https://cdn.svgl.app/anthropic.svg"));
    assert!(is_allowed_url("https://SVGL.APP/x.svg"));
    // Wrong scheme, wrong host, look-alike host, and SSRF attempts are rejected.
    assert!(!is_allowed_url("http://svgl.app/x.svg"));
    assert!(!is_allowed_url("https://evil.com/x.svg"));
    assert!(!is_allowed_url("https://svgl.app.evil.com/x.svg"));
    assert!(!is_allowed_url("https://svgl.app@evil.com/x.svg"));
    assert!(!is_allowed_url("https://169.254.169.254/latest/meta-data"));
}

#[test]
fn strips_scripts_and_handlers() {
    let dirty = r#"<svg xmlns="http://www.w3.org/2000/svg" onload="steal()"><script>evil()</script><path d="M0 0" onclick='x()'/></svg>"#;
    let clean = sanitize_svg(dirty).expect("sanitizes");
    let lower = clean.to_ascii_lowercase();
    assert!(!lower.contains("<script"), "script element removed: {clean}");
    assert!(!lower.contains("onload"), "onload removed: {clean}");
    assert!(!lower.contains("onclick"), "onclick removed: {clean}");
    assert!(lower.contains("<svg"));
    assert!(lower.contains("<path"));
}

#[test]
fn preserves_utf8_and_paths() {
    let dirty = r#"<svg><title>Café — señal</title><path d="M1 2"/></svg>"#;
    let clean = sanitize_svg(dirty).expect("sanitizes");
    assert!(clean.contains("Café — señal"), "utf-8 preserved: {clean}");
    assert!(clean.contains(r#"<path d="M1 2"/>"#));
}

#[test]
fn strips_foreign_object_and_javascript_uri() {
    let dirty = r#"<svg><foreignObject><body>hi</body></foreignObject><a href="javascript:evil()">x</a></svg>"#;
    let clean = sanitize_svg(dirty).expect("sanitizes");
    let lower = clean.to_ascii_lowercase();
    assert!(!lower.contains("foreignobject"));
    assert!(!lower.contains("javascript:"));
}

#[test]
fn rejects_non_svg_and_doctype() {
    assert!(sanitize_svg("<html><body>nope</body></html>").is_err());
    assert!(sanitize_svg(r#"<!DOCTYPE svg [<!ENTITY x "y">]><svg/>"#).is_err());
}

#[test]
fn does_not_mistake_similar_element_names() {
    // `<scripture>` and an attribute starting with `on` inside a word must survive.
    let dirty = r#"<svg><scripture>keep</scripture><path data-only="1"/></svg>"#;
    let clean = sanitize_svg(dirty).expect("sanitizes");
    assert!(clean.contains("<scripture>keep</scripture>"), "{clean}");
    assert!(clean.contains(r#"data-only="1""#), "{clean}");
}
