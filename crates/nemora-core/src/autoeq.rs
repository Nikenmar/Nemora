//! The AutoEQ index (PLAN/18 D5): which headphones have a correction profile, read from the
//! repository's `results/INDEX.md`, and one profile's `ParametricEQ.txt`. Both are fetched only when
//! the user asks (Settings > Equalizer > Headphone correction); no profile ships with Nemora, as the
//! measurement data carries no stated terms. The index is cached by the caller.

const BASE: &str = "https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results";

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "specta", derive(specta::Type))]
pub struct Headphone {
    pub name: String,
    /// Who measured it (oratory1990, crinacle, ...).
    pub source: String,
    /// The rig, when the index names one ("711", "GRAS RA0045").
    pub rig: Option<String>,
    /// The folder under `results/`, URL-encoded as the index writes it.
    pub path: String,
}

/// Reads INDEX.md: lines like `- [Sennheiser HD 600](./oratory1990/over-ear/Sennheiser%20HD%20600)
/// by oratory1990` and `... by crinacle on 711`.
pub fn parse_index(text: &str) -> Vec<Headphone> {
    let mut out = Vec::new();
    for line in text.lines() {
        let Some(rest) = line.trim().strip_prefix("- [") else { continue };
        // The name may itself hold brackets ("Model [v2]"): the link starts at the last "](./".
        let Some(split) = rest.rfind("](./") else { continue };
        let name = &rest[..split];
        let after = &rest[split + 4..];
        // The path may hold parentheses ("Aero (ANC Off)"): it ends at the ") by " that follows.
        let Some(end) = after.rfind(") by ") else { continue };
        let path = &after[..end];
        let by = &after[end + 5..];
        let (source, rig) = match by.split_once(" on ") {
            Some((s, r)) => (s.trim(), Some(r.trim().to_owned())),
            None => (by.trim(), None),
        };
        if name.is_empty() || path.is_empty() || path.contains("..") {
            continue;
        }
        out.push(Headphone { name: name.to_owned(), source: source.to_owned(), rig, path: path.to_owned() });
    }
    out
}

/// The URL of a headphone's `ParametricEQ.txt`.
pub fn profile_url(headphone: &Headphone) -> String {
    let file = headphone.path.rsplit('/').next().unwrap_or_default();
    format!("{BASE}/{}/{file}%20ParametricEQ.txt", headphone.path)
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(20)))
        .user_agent(concat!("Nemora ", env!("CARGO_PKG_VERSION"), " (https://github.com/Nikenmar/Nemora)"))
        .build()
        .into()
}

fn get(url: &str) -> Result<String, String> {
    agent()
        .get(url)
        .call()
        .map_err(|e| e.to_string())?
        .body_mut()
        .with_config()
        .limit(8 * 1024 * 1024)
        .read_to_string()
        .map_err(|e| e.to_string())
}

/// Fetches INDEX.md (about 0.9 MB); the caller caches the text.
pub fn fetch_index() -> Result<String, String> {
    get(&format!("{BASE}/INDEX.md"))
}

/// Fetches one headphone's profile text.
pub fn fetch_profile(headphone: &Headphone) -> Result<String, String> {
    get(&profile_url(headphone))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The head of INDEX.md as fetched on 2026-11-01, plus the shapes that need care.
    const INDEX: &str = "# Index\nThis is a list of all equalization profiles. Target is in parentheses if there are results with multiple targets\nfrom the same source.\n\n- [1Custom SA02](./crinacle/711%20in-ear/1Custom%20SA02) by crinacle on 711\n- [1MORE Aero (ANC Off)](./HypetheSonics/GRAS%20RA0045%20in-ear/1MORE%20Aero%20(ANC%20Off)) by HypetheSonics on GRAS RA0045\n- [Sennheiser HD 600](./oratory1990/over-ear/Sennheiser%20HD%20600) by oratory1990\n- [Model [v2]](./x/in-ear/Model%20[v2]) by x\n- [bad](../../etc) by nobody\n";

    #[test]
    fn the_index_is_read_with_its_sources_rigs_and_paths() {
        let all = parse_index(INDEX);
        assert_eq!(all.len(), 4, "the line leaving results/ is dropped");
        assert_eq!(all[0].rig.as_deref(), Some("711"));
        assert_eq!(all[1].name, "1MORE Aero (ANC Off)");
        assert_eq!(all[1].path, "HypetheSonics/GRAS%20RA0045%20in-ear/1MORE%20Aero%20(ANC%20Off)");
        assert_eq!(all[1].rig.as_deref(), Some("GRAS RA0045"));
        assert_eq!((all[2].source.as_str(), all[2].rig.as_deref()), ("oratory1990", None));
        assert_eq!(all[3].name, "Model [v2]");
        assert_eq!(
            profile_url(&all[2]),
            "https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/oratory1990/over-ear/Sennheiser%20HD%20600/Sennheiser%20HD%20600%20ParametricEQ.txt"
        );
    }
}
