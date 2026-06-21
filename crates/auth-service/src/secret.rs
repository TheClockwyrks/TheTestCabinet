//! Password hashing (Argon2id) and bearer-token minting.
//!
//! Passwords are stored as Argon2id PHC strings (salt + parameters embedded);
//! bearer tokens are 256 bits of OS randomness, returned to the client once and
//! stored only as their SHA-256 hash, so a leaked database cannot authenticate.

use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use rand::RngCore;
use sha2::{Digest, Sha256};

/// The minimum password length accepted at registration. Deliberately modest —
/// the service sits behind the private network — but enough to reject empties
/// and trivial typos.
pub const MIN_PASSWORD_LEN: usize = 8;

/// Hash a plaintext password into an Argon2id PHC string with a fresh random
/// salt. The salt bytes come from the OS RNG (via the `rand` crate) and are
/// encoded into the PHC string, so verification needs nothing but the stored
/// hash.
pub fn hash_password(password: &str) -> Result<String, argon2::password_hash::Error> {
    let mut salt_bytes = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut salt_bytes);
    let salt = SaltString::encode_b64(&salt_bytes)?;
    let hash = Argon2::default()
        .hash_password(password.as_bytes(), &salt)?
        .to_string();
    Ok(hash)
}

/// Verify a plaintext password against a stored Argon2id PHC string. A malformed
/// stored hash, like a wrong password, returns `false` — never a panic.
pub fn verify_password(password: &str, phc: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(phc) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

/// Mint a fresh opaque bearer token: 256 bits of OS randomness, hex-encoded. The
/// raw value is shown to the client exactly once; only its [`hash_token`] is
/// stored.
pub fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    hex::encode(bytes)
}

/// The hex-encoded SHA-256 of a bearer token, the value stored in and looked up
/// from the `token` table. SHA-256 (not Argon2) is right here: a token is
/// already 256 bits of uniform randomness, so a fast hash is sufficient and lets
/// verification stay cheap on every request.
pub fn hash_token(raw: &str) -> String {
    hex::encode(Sha256::digest(raw.as_bytes()))
}
