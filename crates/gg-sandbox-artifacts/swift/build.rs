//! Build the `swift` arm's artifacts. Everything with any substance in it is in
//! [`gg_artifact_build`], once, rather than in each of the arm crates.

fn main() {
    gg_artifact_build::arm("swift");
}
