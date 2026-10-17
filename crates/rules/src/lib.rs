//! ChemScan LCA instrument settings, derived from the sample's characteristics.
//!
//! - Ion size: liquid 2.0 (organic or not); solid 6.0, or 3.5 if organic to
//!   avoid damaging the sample; gas must not exceed 1.3 (reported as a maximum).
//! - Delta V: weight in grams x 250 for organic, x 100 for inorganic.
//! - Threshold: liquid delta V / 3, solid delta V / 2, gas delta V x 2.
//! - Matrix size: 5, or 4 on LCA version 1.03 or lower.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SampleState {
    Solid,
    Liquid,
    Gas,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Nature {
    Organic,
    Inorganic,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub ion_size: f64,
    /// True when `ion_size` is an upper limit rather than an exact value (gas).
    pub ion_size_is_max: bool,
    pub delta_v: f64,
    pub threshold: f64,
    pub matrix_size: u32,
}

/// Versions at or below this one need the smaller matrix.
const LEGACY_MATRIX_VERSION: [u32; 2] = [1, 3];

pub fn ion_size(state: SampleState, nature: Nature) -> (f64, bool) {
    match (state, nature) {
        (SampleState::Liquid, _) => (2.0, false),
        (SampleState::Solid, Nature::Organic) => (3.5, false),
        (SampleState::Solid, Nature::Inorganic) => (6.0, false),
        (SampleState::Gas, _) => (1.3, true),
    }
}

pub fn delta_v(nature: Nature, weight_grams: f64) -> f64 {
    match nature {
        Nature::Organic => weight_grams * 250.0,
        Nature::Inorganic => weight_grams * 100.0,
    }
}

pub fn threshold(state: SampleState, delta_v: f64) -> f64 {
    match state {
        SampleState::Liquid => delta_v / 3.0,
        SampleState::Solid => delta_v / 2.0,
        SampleState::Gas => delta_v * 2.0,
    }
}

/// Parses "1.03", "v1.03", "1" or "1.03.2" into numeric segments.
pub fn parse_version(version: &str) -> Result<Vec<u32>, String> {
    let trimmed = version.trim().trim_start_matches(['v', 'V']);
    if trimmed.is_empty() {
        return Err("Enter the LCA version, for example 1.04".into());
    }
    trimmed
        .split('.')
        .map(|part| part.parse::<u32>())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| format!("\"{}\" is not a version number", version.trim()))
}

fn at_or_below(version: &[u32], limit: &[u32]) -> bool {
    let len = version.len().max(limit.len());
    for i in 0..len {
        let a = version.get(i).copied().unwrap_or(0);
        let b = limit.get(i).copied().unwrap_or(0);
        if a != b {
            return a < b;
        }
    }
    true
}

pub fn matrix_size(version: &str) -> Result<u32, String> {
    let parsed = parse_version(version)?;
    Ok(if at_or_below(&parsed, &LEGACY_MATRIX_VERSION) { 4 } else { 5 })
}

pub fn calculate(
    state: SampleState,
    nature: Nature,
    weight_grams: f64,
    version: &str,
) -> Result<Settings, String> {
    if !weight_grams.is_finite() || weight_grams <= 0.0 {
        return Err("Sample weight must be more than 0 g".into());
    }
    let (ion_size, ion_size_is_max) = ion_size(state, nature);
    let delta_v = delta_v(nature, weight_grams);
    Ok(Settings {
        ion_size,
        ion_size_is_max,
        delta_v,
        threshold: threshold(state, delta_v),
        matrix_size: matrix_size(version)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use Nature::*;
    use SampleState::*;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn liquid_ion_size_is_2_for_both_natures() {
        assert_eq!(ion_size(Liquid, Organic), (2.0, false));
        assert_eq!(ion_size(Liquid, Inorganic), (2.0, false));
    }

    #[test]
    fn solid_ion_size_is_6_or_3_5_when_organic() {
        assert_eq!(ion_size(Solid, Inorganic), (6.0, false));
        assert_eq!(ion_size(Solid, Organic), (3.5, false));
    }

    #[test]
    fn gas_ion_size_is_capped_at_1_3() {
        assert_eq!(ion_size(Gas, Organic), (1.3, true));
        assert_eq!(ion_size(Gas, Inorganic), (1.3, true));
    }

    #[test]
    fn delta_v_uses_250_for_organic_and_100_for_inorganic() {
        assert!(close(delta_v(Organic, 2.0), 500.0));
        assert!(close(delta_v(Inorganic, 2.0), 200.0));
        assert!(close(delta_v(Organic, 0.4), 100.0));
    }

    #[test]
    fn threshold_depends_on_state() {
        assert!(close(threshold(Liquid, 300.0), 100.0));
        assert!(close(threshold(Solid, 300.0), 150.0));
        assert!(close(threshold(Gas, 300.0), 600.0));
    }

    #[test]
    fn matrix_size_is_4_at_or_below_1_03() {
        for v in ["1.03", "1.02", "1.0", "1", "0.9", "v1.03", " 1.03 "] {
            assert_eq!(matrix_size(v), Ok(4), "version {v}");
        }
    }

    #[test]
    fn matrix_size_is_5_above_1_03() {
        for v in ["1.04", "1.10", "1.03.1", "2", "2.0"] {
            assert_eq!(matrix_size(v), Ok(5), "version {v}");
        }
    }

    #[test]
    fn bad_versions_are_rejected() {
        assert!(matrix_size("").is_err());
        assert!(matrix_size("abc").is_err());
        assert!(matrix_size("1..2").is_err());
    }

    #[test]
    fn full_calculation_for_organic_solid() {
        let s = calculate(Solid, Organic, 1.2, "1.05").unwrap();
        assert_eq!(s.ion_size, 3.5);
        assert!(!s.ion_size_is_max);
        assert!(close(s.delta_v, 300.0));
        assert!(close(s.threshold, 150.0));
        assert_eq!(s.matrix_size, 5);
    }

    #[test]
    fn full_calculation_for_inorganic_gas_on_old_lca() {
        let s = calculate(Gas, Inorganic, 0.5, "1.03").unwrap();
        assert_eq!(s.ion_size, 1.3);
        assert!(s.ion_size_is_max);
        assert!(close(s.delta_v, 50.0));
        assert!(close(s.threshold, 100.0));
        assert_eq!(s.matrix_size, 4);
    }

    #[test]
    fn non_positive_weight_is_rejected() {
        assert!(calculate(Liquid, Organic, 0.0, "1.04").is_err());
        assert!(calculate(Liquid, Organic, -1.0, "1.04").is_err());
        assert!(calculate(Liquid, Organic, f64::NAN, "1.04").is_err());
    }
}
