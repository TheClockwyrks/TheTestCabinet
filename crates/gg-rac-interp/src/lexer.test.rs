//! Lexer unit tests.

use super::{TokenKind, lex};

/// Collect just the token kinds, dropping offsets, for terse assertions.
fn kinds(source: &str) -> Vec<TokenKind> {
    lex(source)
        .expect("source lexes")
        .into_iter()
        .map(|t| t.kind)
        .collect()
}

#[test]
fn lexes_identifiers_numbers_and_strings() {
    let kinds = kinds(r#"let x = 12.5 + "hi""#);
    assert_eq!(
        kinds,
        vec![
            TokenKind::Ident("let".into()),
            TokenKind::Ident("x".into()),
            TokenKind::Assign,
            TokenKind::Number(12.5),
            TokenKind::Plus,
            TokenKind::Str("hi".into()),
        ]
    );
}

#[test]
fn distinguishes_one_and_two_char_operators() {
    let kinds = kinds("== = != ! <= < >= > && ||");
    assert_eq!(
        kinds,
        vec![
            TokenKind::Eq,
            TokenKind::Assign,
            TokenKind::Ne,
            TokenKind::Bang,
            TokenKind::Le,
            TokenKind::Lt,
            TokenKind::Ge,
            TokenKind::Gt,
            TokenKind::And,
            TokenKind::Or,
        ]
    );
}

#[test]
fn skips_line_comments_and_whitespace() {
    let kinds = kinds("a // this is ignored\n+ b");
    assert_eq!(
        kinds,
        vec![
            TokenKind::Ident("a".into()),
            TokenKind::Plus,
            TokenKind::Ident("b".into()),
        ]
    );
}

#[test]
fn resolves_string_escapes() {
    let kinds = kinds(r#""a\n\t\"b\\A""#);
    assert_eq!(kinds, vec![TokenKind::Str("a\n\t\"b\\A".into())]);
}

#[test]
fn a_leading_minus_is_a_separate_operator_not_a_signed_literal() {
    // `a-1` must be three tokens so subtraction parses; the lexer never folds the sign.
    let kinds = kinds("a-1");
    assert_eq!(
        kinds,
        vec![
            TokenKind::Ident("a".into()),
            TokenKind::Minus,
            TokenKind::Number(1.0),
        ]
    );
}

#[test]
fn unterminated_string_is_an_error_not_a_panic() {
    let err = lex(r#""oops"#).expect_err("an unterminated string is rejected");
    assert!(err.message.contains("unterminated"));
}

#[test]
fn a_lone_ampersand_is_a_helpful_error() {
    let err = lex("a & b").expect_err("a lone `&` is rejected");
    assert!(err.message.contains("&&"));
}
