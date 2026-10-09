//! Tests for the shared showcase helpers.

use super::description_image_references;

#[test]
fn description_image_references_extracts_only_flat_relative_names() {
    // Bare relative names come back (percent-escapes decoded, angle-bracketed
    // and titled destinations handled, duplicates folded); everything the
    // renderer would not resolve against the showcase — absolute, anchored,
    // schemed — and every name the flat namespace refuses is skipped.
    let description = "\
# My Game\n\
![Banner](banner.png)\n\
![Same again](banner.png)\n\
![Encoded](my%20shot.png)\n\
![Bracketed](<two words.png> \"With a title\")\n\
![Titled](titled.png \"The title\")\n\
![Absolute](/logo.png)\n\
![Anchor](#top)\n\
![External](https://example.com/x.png)\n\
![Data](data:image/png;base64,AAAA)\n\
![Traversal](../escape.png)\n\
![Dotted](shot..final.png)\n\
![Manifest](showcase.toml)\n";
    assert_eq!(
        description_image_references(description),
        vec!["banner.png", "my shot.png", "two words.png", "titled.png"],
    );
}
