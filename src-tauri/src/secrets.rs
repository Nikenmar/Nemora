//! Encrypted-credential support.
//!
//! A webview has no synchronous crypto, and Web Crypto has no scrypt. The key
//! derivation for `safeStorage` therefore lives here: Node's
//! `crypto.scryptSync(secret, "salt", 32)` defaults are N = 16384 (2^14),
//! r = 8, p = 1, and the derived key must match byte-for-byte or credentials
//! encrypted by Nora 3.4.5 become unreadable. The AES-CBC half stays in
//! TypeScript (`src/platform/core/secrets/safeStorage.ts`) via `crypto.subtle`,
//! which supports it natively.

use scrypt::{scrypt, Params};

/// scrypt log2(N) for N = 16384, Node's `scryptSync` default.
const SCRYPT_LOG_N: u8 = 14;
/// scrypt r, Node's `scryptSync` default.
const SCRYPT_R: u32 = 8;
/// scrypt p, Node's `scryptSync` default.
const SCRYPT_P: u32 = 1;
/// The salt string the Electron build hard-coded.
const SCRYPT_SALT: &[u8] = b"salt";
/// AES-256 key length in bytes.
const KEY_LENGTH: usize = 32;

/// Derives the 32-byte AES-256 key from the app's encryption secret, matching
/// `crypto.scryptSync(secret, "salt", 32)` byte-for-byte.
#[tauri::command]
pub fn secrets_scrypt_key(secret: String) -> Result<Vec<u8>, String> {
    let params = Params::new(SCRYPT_LOG_N, SCRYPT_R, SCRYPT_P, KEY_LENGTH)
        .map_err(|error| error.to_string())?;
    let mut key = vec![0u8; KEY_LENGTH];
    scrypt(secret.as_bytes(), SCRYPT_SALT, &params, &mut key).map_err(|error| error.to_string())?;
    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::secrets_scrypt_key;

    /// Key bytes produced by Node `crypto.scryptSync(secret, "salt", 32)`
    /// with the default params, captured while building the golden fixtures.
    const NODE_KEY_HEX: &str = "9c193d1a05b56e8ddd488b5c95322063aefd7065c0af68ec3a7ba98750706fb0";

    #[test]
    fn derives_the_same_key_as_node_scryptsync() {
        let key = secrets_scrypt_key("test-encryption-secret-3.4.5".to_string()).unwrap();
        let hex: String = key.iter().map(|byte| format!("{byte:02x}")).collect();
        assert_eq!(hex, NODE_KEY_HEX);
    }

    #[test]
    fn derives_a_different_key_for_a_different_secret() {
        let key = secrets_scrypt_key("short".to_string()).unwrap();
        let hex: String = key.iter().map(|byte| format!("{byte:02x}")).collect();
        assert_eq!(
            hex,
            "84794af175389c24e03f3722796cdc38fc46f43f5eca29f87d020bc516b11f99"
        );
    }

    #[test]
    fn returns_a_32_byte_key() {
        let key = secrets_scrypt_key("anything".to_string()).unwrap();
        assert_eq!(key.len(), 32);
    }
}
