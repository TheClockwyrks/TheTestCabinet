//! Fixed RSA keys the Access tests sign assertions with, and the key set a test
//! serves as the team's certificates.
//!
//! Generated once with `openssl genrsa 2048` for these tests alone and used nowhere
//! else. They are fixed rather than generated per test because RSA key generation in
//! an unoptimized test build takes seconds, and every test runs in its own process.
//! Each private key is PKCS#1 DER, base64-encoded; each public key is its JWK
//! modulus and exponent.

use std::time::Duration;

use base64::Engine;
use jsonwebtoken::{Algorithm, EncodingKey, Header};

/// One signing key: its key id, its private half, and its public JWK components.
pub(crate) struct TestKey {
    /// The `kid` the key is published and signs under.
    pub kid: &'static str,
    /// The PKCS#1 DER private key, base64-encoded.
    der: &'static str,
    /// The JWK modulus, base64url.
    n: &'static str,
    /// The JWK exponent, base64url.
    e: &'static str,
}

/// Test signing key `a`.
pub(crate) const KEY_A: TestKey = TestKey {
    kid: "test-key-a",
    der: "\
MIIEowIBAAKCAQEA06RFQPI/7aZAZ/2ty826p10ZWy9p3ErUkSUOeqq3cvjHMM+E1Nmf2CcN7nAG\
u5Yeh0nRX7kPdsFBtEk3gzSWtLPoICOAWFj0vy0EUzlOiiInvzGoxu9WIw7FFFYmkwWYjejacRw7\
ug0tYzQKMxGdY6oK4dzg8g/Y2pazQyihFt/JjStcAj7x1uRPkUC+5Hsuilm5YWAfC8thXo9vWEXL\
9Ib4SCyHE7CONBpnTEcDVcp4NdNrP+R7P6nJOF8RYBWrq2gadsUkavjlcnljZZZyBX+eY9Jffj2F\
QMBHi4bFen3G+zIQHUjcrASjcf2stxnsehVqG3ubmSDS7BuCdFvvHQIDAQABAoIBAA7rno9C1NNv\
/EvohDNhRFaut04opE2pv90gr+nhda/nDoHoK1znH7/5FuAXqT3Zyjqu71IQhaDRZIytebqn/zTr\
lwKHBjIUSWLd7Vdhq6IM4OD3gwbNUjUEAkxZ+3uzcgsVHqtJOoO2EJxVC6AIjqA7WWuNaxVdnSPh\
6m7iYyLt0IXCyYnNeRLuxnuTx3TXfgbmu6t/7dB7m2CU+710iuHSkKX/ahX+gI6XanHv4CmekSnQ\
saomfALtYA/fd+69YDvIx56cMw0kbAbqMoo/KMN4FsMLOBuE81k7Wwz2zMUlatCWr0eVSjQCUPZ9\
JTOg2M7GC2DFXOmH12JRCv/jNnkCgYEA/IOr9bpI+wTSQgH5GAjJq7HgI27lNN/kF2HEfiZMucd7\
zpgc2YT7PgvLtYRbq8favnO7J0qNVTcX2WGYXcg8VgKSmq0u8/WbSu7LiZjTxByZp9iyYNLfZN1w\
cHLzOYyJujGrFVP3n7Ssmv78xgOnI2/0AxTZMszHXm8KdqUfr3kCgYEA1pAqAz9p1++KzlxjAfv1\
K//CQ3kTPglqi4nwa/9Fx2VpG/Fpa7zNlD+/IS/42ynF9bdorYUMHeg+4We8gNr5CyBj8f1uXpg4\
Co8UrVoG0SuFYzSesPXAAzST2iAwfcofGrVNo68CJ5qFJpaY6sIg/g8AMM4o+NaAt21D8uS8X8UC\
gYEAqeH//7rLPK3asvPW3LeUzkFGVTBXXgI+1wg8hM5JkjdF8RDfX+wah3yyGTWp4uD7JmSABggf\
G7SMBACn3HhJN2hVr2BSFWkoh/otzy2VUvwW2BhusbtM9fQQoGaFgjMtuamOuzOZhcWs1j40Wxe8\
C5hXJveQxJ+Ghd7YwEeJEKkCgYB623WTAn6CrKDYZMI0YqcSGJKNvAgun4moeMV3sWWtNP4oh+UL\
UcKNPqscP7HJHHRDrE99/A7iGRfYTWP8jGXJ3zQbXjgSZirAsQjv8fqxTrBEC99KCI13yGVYotHh\
VRjWXDYmoZEkSDAx1k2dLqdhkglT6NhBE+IEJcagkCTk2QKBgDwgbjiWyG68t1SNyE7sxoYhanbK\
wJDruBHvdWQaSUq1BCLHNqNXMmtJu8MpRJf/OtFhPNUm+Ns2UDlZ7hvVA6oIxB95dCmTgssrGl+S\
UNJPUovkgol6+GWGjfVKPkayrz/HhlfJtfPaN47t2cuu7Y5V10JyhkfSKDNdZiN+3jaI",
    n: "\
06RFQPI_7aZAZ_2ty826p10ZWy9p3ErUkSUOeqq3cvjHMM-\
E1Nmf2CcN7nAGu5Yeh0nRX7kPdsFBtEk3gzSWtLPoICOAWFj0vy0EUzlOiiInvzGoxu9WIw7FFFY\
mkwWYjejacRw7ug0tYzQKMxGdY6oK4dzg8g_Y2pazQyihFt_JjStcAj7x1uRPkUC-\
5Hsuilm5YWAfC8thXo9vWEXL9Ib4SCyHE7CONBpnTEcDVcp4NdNrP-\
R7P6nJOF8RYBWrq2gadsUkavjlcnljZZZyBX-\
eY9Jffj2FQMBHi4bFen3G-zIQHUjcrASjcf2stxnsehVqG3ubmSDS7BuCdFvvHQ",
    e: "AQAB",
};

/// Test signing key `b`.
pub(crate) const KEY_B: TestKey = TestKey {
    kid: "test-key-b",
    der: "\
MIIEowIBAAKCAQEAqB87kyi9jct7aWCXsrVQ3P3bHp766gg83B8C2Lbjl110+gois7O2kXqQpk+J\
luE2CuoQ3iSFAmPENRZk+Uiad943vVcx3495lKR3JXUCf2qpgKAoMCy7K0/VjhLuO8sm0opSrL3T\
soQFSHw6VgU7KxDnHPFSiRlbuSIgyjeb+p9tGXA2NFEhpZrZSL94Zr6vnm/BmS07dTkKcmHLzDxd\
uG3mDO3Ga9ZrdRiiLbtXMyfEfcjlHwC+V3Do3sU0f90oFpf9DnnSc1Z5ITUAWdHpK0jEem5ViO+R\
ZfRyfcXOzTcSf06h8sk2f1EucX/6XdQio/Dec+3u7L+Ff5Pd1eMk2QIDAQABAoIBAEW/y3IWrWml\
+XnzCoyoX7eHlEBkebndmA5EyWQKoGqcadsQmGwQi5ZYkKmHBxCzN74YdM4MvagLpwvVUigAAKHp\
bhueEMFs32aVQx8lp9cf89m62GGANVjXQsSyQudItb8Uhw9GpA0Ea8KyU2t7uRv5Y8Dkt7bMb/rj\
V1I99vbnP4w2LZMCiI3SHM0bxEBBdqGM3d4I+61Ir9gOY6Ba+5z9UE6nscf/Y8JYSgqLB38WN0hu\
ldZ/puBYubMmXs/D/rXUUXmlRCJNM7rB5xp4wYmdW1/XHZadl8N6nb0+N8v2JXEs6aoBafcWHUt1\
LCHu3u123I3tGw4i95MmnRKcR0cCgYEA5ciHNcGTkoj+sEANEeGdm/JoP6TFQVtBuJJIU602ITH5\
PMl9cDeZSZLo/xWMe/mpxpsxSFHLfut3ZQ0z7sK1gpfatKkojnPmpPVE2d1KDcmN8VAftIJnccNi\
DKJFAECuFYIZRSSgANVU1JqDkXJsmA1bLFMdTgPFJURPbV4OZlsCgYEAu022JYAweS9GQzAYUGcu\
d3OZIIGZ1FpCq4kz297OO+KeeODD8jJTa7/17S0o7dGjZ7GpYawOdRz0ePfy3QdpRtf+DZxu08xu\
Meb+Gb5vYuFGx7lEFZ0+CPF5Wwa+aB39TC3STy/MRT8Z9D4DqKpfTKtd1FFHerRuM8CGw5XKz9sC\
gYBhqR6+XC2qZAtLQY3MgcWI2DgyhIdJxc1i8tlGpyGQbjrt+P0VSqwdtxDMCY6RyoS74o3JnOoO\
YWl3S2s9GQgoHv5XNmYEVYI7rfq7Ve/5eCaZ32H6SEpK8a2kjPsiplrWzVqMJorSj9jkG1+725QH\
8/VCG3kjBTsvIZ9YbldUbQKBgCazLtBexSU03FqjhFKQjyxFKT1rKcKTh7Tzm1Bxn8EF2OJ25mWT\
emMH/aMssok4yH9zWOECcNZHzkd0S6zZjCoEFMzxJoECez46UQQ2scMHct1vbR7eJ2QnqIBjS1It\
6BkmWo7b/GPOXul1KsJduWUY/0EQLimvQBnXTMD6oTYDAoGBAKuA77y4CVgBW2RpaitpbpviHsqp\
Si/tbA63QJ6yqmrjL9lgiDnrsJ+PNCYuwq1LL8+HnOWy0iAXmh4mNszCwZL2OPWgdTRRAtTmsv+U\
9nzX5IH2J9JsH8V6xs7BnExZNlK3i7gWMsWyZNUjha88bB2GkIylKCV6PaYc0IKXH3Nq",
    n: "\
qB87kyi9jct7aWCXsrVQ3P3bHp766gg83B8C2Lbjl110-gois7O2kXqQpk-\
JluE2CuoQ3iSFAmPENRZk-Uiad943vVcx3495lKR3JXUCf2qpgKAoMCy7K0_VjhLuO8sm0opSrL3\
TsoQFSHw6VgU7KxDnHPFSiRlbuSIgyjeb-\
p9tGXA2NFEhpZrZSL94Zr6vnm_BmS07dTkKcmHLzDxduG3mDO3Ga9ZrdRiiLbtXMyfEfcjlHwC-\
V3Do3sU0f90oFpf9DnnSc1Z5ITUAWdHpK0jEem5ViO-\
RZfRyfcXOzTcSf06h8sk2f1EucX_6XdQio_Dec-3u7L-Ff5Pd1eMk2Q",
    e: "AQAB",
};

impl TestKey {
    /// The key's public half as a JWK.
    pub fn jwk(&self) -> serde_json::Value {
        serde_json::json!({
            "kid": self.kid,
            "kty": "RSA",
            "alg": "RS256",
            "use": "sig",
            "n": self.n,
            "e": self.e,
        })
    }

    /// Sign `claims` as an RS256 assertion under this key's id.
    pub fn sign(&self, claims: &serde_json::Value) -> String {
        self.sign_as(self.kid, claims)
    }

    /// Sign `claims` with this key while naming `kid` in the header.
    pub fn sign_as(&self, kid: &str, claims: &serde_json::Value) -> String {
        let der = base64::engine::general_purpose::STANDARD
            .decode(self.der)
            .expect("the fixture key is valid base64");
        let mut header = Header::new(Algorithm::RS256);
        header.kid = Some(kid.to_string());
        jsonwebtoken::encode(&header, claims, &EncodingKey::from_rsa_der(&der))
            .expect("the fixture key signs")
    }
}

/// The key set a team publishes, as `/cdn-cgi/access/certs` answers it.
pub(crate) fn key_set(keys: &[&TestKey]) -> serde_json::Value {
    serde_json::json!({
        "keys": keys.iter().map(|key| key.jwk()).collect::<Vec<_>>(),
        "public_cert": { "kid": keys.first().map(|key| key.kid), "cert": "unused" },
        "public_certs": [],
    })
}

/// Seconds since the epoch, `offset` from now.
pub(crate) fn epoch_in(offset: Duration, past: bool) -> u64 {
    let now = jsonwebtoken::get_current_timestamp();
    if past {
        now - offset.as_secs()
    } else {
        now + offset.as_secs()
    }
}

/// The claims of a person's assertion for `audience`, valid for an hour.
pub(crate) fn person_claims(email: &str, audience: &str) -> serde_json::Value {
    serde_json::json!({
        "aud": [audience],
        "email": email,
        "exp": epoch_in(Duration::from_secs(3600), false),
        "iat": epoch_in(Duration::from_secs(60), true),
        "iss": "https://shrill-term-5c16.cloudflareaccess.com",
        "sub": "a-person",
        "type": "app",
    })
}

/// The claims of an Access service token's assertion for `audience`, valid for an
/// hour: a `common_name` and an empty `email`, as Cloudflare mints them.
pub(crate) fn service_claims(common_name: &str, audience: &str) -> serde_json::Value {
    serde_json::json!({
        "aud": [audience],
        "common_name": common_name,
        "email": "",
        "exp": epoch_in(Duration::from_secs(3600), false),
        "iat": epoch_in(Duration::from_secs(60), true),
        "iss": "https://shrill-term-5c16.cloudflareaccess.com",
        "sub": "",
        "type": "app",
    })
}
