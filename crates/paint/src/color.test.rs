use super::*;

#[test]
fn parses_rgb_and_rgba() {
    let c = Color::parse_hex("#ff8000").unwrap();
    assert_eq!(c.to_rgba8(), [255, 128, 0, 255]);
    let c = Color::parse_hex("#11223344").unwrap();
    assert_eq!(c.to_rgba8(), [17, 34, 51, 68]);
}

#[test]
fn tolerates_missing_hash() {
    assert_eq!(
        Color::parse_hex("00ff00").unwrap().to_rgba8(),
        [0, 255, 0, 255]
    );
}

#[test]
fn rejects_bad_input() {
    assert!(Color::parse_hex("#fff").is_err());
    assert!(Color::parse_hex("#gggggg").is_err());
}

#[test]
fn roundtrips_8bit() {
    for v in [0u8, 1, 64, 127, 128, 200, 255] {
        let c = Color::from_rgba8([v, v, v, v]);
        assert_eq!(c.to_rgba8(), [v, v, v, v]);
    }
}

#[test]
fn background_parses() {
    assert_eq!(
        Background::parse("transparent").unwrap(),
        Background::Transparent
    );
    assert_eq!(
        Background::parse("TRANSPARENT").unwrap(),
        Background::Transparent
    );
    assert!(matches!(
        Background::parse("#000000").unwrap(),
        Background::Solid(_)
    ));
}
