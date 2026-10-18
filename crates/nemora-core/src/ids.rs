//! Text ids: 128 bits written as 26 lowercase base32 characters (RFC 4648 alphabet, no padding).
//! Song ids and device ids share the encoding.

const BASE32: &[u8; 32] = b"abcdefghijklmnopqrstuvwxyz234567";

pub const ID_LEN: usize = 26;

pub fn encode(bytes: &[u8; 16]) -> String {
    let mut out = String::with_capacity(ID_LEN);
    let mut buffer: u32 = 0;
    let mut bits = 0;
    for &byte in bytes {
        buffer = (buffer << 8) | u32::from(byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(BASE32[((buffer >> bits) & 31) as usize] as char);
        }
    }
    if bits > 0 {
        out.push(BASE32[((buffer << (5 - bits)) & 31) as usize] as char);
    }
    out
}

/// Decodes the canonical spelling only: 26 characters from the alphabet, the 2 trailing bits zero,
/// so one id never has two spellings.
pub fn decode(s: &str) -> Option<[u8; 16]> {
    if s.len() != ID_LEN {
        return None;
    }
    let mut bytes = [0u8; 16];
    let mut buffer: u32 = 0;
    let mut bits = 0;
    let mut index = 0;
    for c in s.bytes() {
        let value = BASE32.iter().position(|&b| b == c)? as u32;
        buffer = (buffer << 5) | value;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            bytes[index] = (buffer >> bits) as u8;
            index += 1;
        }
    }
    (buffer & ((1 << bits) - 1) == 0).then_some(bytes)
}

/// A fresh random id (device ids).
pub fn random() -> String {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).expect("the OS random source is available");
    encode(&bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips() {
        let bytes = [0xde, 0xad, 0xbe, 0xef, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0xfe, 0xff];
        let text = encode(&bytes);
        assert_eq!(text.len(), ID_LEN);
        assert_eq!(decode(&text), Some(bytes));
    }

    #[test]
    fn rejects_non_canonical_text() {
        assert_eq!(decode("too-short"), None);
        assert_eq!(decode("ABCDEFGHIJKLMNOPQRSTUVWXYZ"), None);
        // Same 128 bits as "aaaa...a" but a non-zero pad: a second spelling of one id.
        assert_eq!(decode("aaaaaaaaaaaaaaaaaaaaaaaaab"), None);
    }

    #[test]
    fn random_ids_differ() {
        assert_ne!(random(), random());
    }
}
