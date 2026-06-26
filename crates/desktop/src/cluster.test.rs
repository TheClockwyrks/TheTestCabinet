use super::*;

#[test]
fn substitute_fills_owner_and_tag() {
    let input = "image: ghcr.io/REPLACE_OWNER/tcab-backend:REPLACE_TAG";
    let out = substitute(input);
    assert!(
        out.contains(&format!(
            "ghcr.io/{GHCR_OWNER}/tcab-backend:{}",
            image_tag()
        )),
        "owner and tag should be filled in: {out}"
    );
    assert!(!out.contains("REPLACE_OWNER"));
    assert!(!out.contains("REPLACE_TAG"));
}

#[test]
fn substitute_leaves_registry_match_key() {
    // `REPLACE_REGISTRY` is a kustomize match key the images block rewrites, not a
    // value to fill in — it must survive substitution untouched.
    let input = "  - name: REPLACE_REGISTRY/tcab-backend";
    assert_eq!(substitute(input), input);
}

#[test]
fn image_tag_defaults_to_latest_without_build_stamp() {
    // With no compile-time TCAB_DESKTOP_IMAGE_TAG, local builds pull `:latest`.
    if option_env!("TCAB_DESKTOP_IMAGE_TAG").is_none() {
        assert_eq!(image_tag(), "latest");
    }
}
