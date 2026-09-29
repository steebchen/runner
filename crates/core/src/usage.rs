//! Cost of usage records: as reported by the agent, or estimated from tokens
//! with user-provided per-model prices (Codex reports tokens only).

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::store::{Store, UsageRecord};

/// USD per million tokens.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ModelPrice {
    pub input: f64,
    pub cached_input: f64,
    pub output: f64,
}

pub type Pricing = HashMap<String, ModelPrice>;

pub fn load_pricing(store: &Store) -> Pricing {
    store.setting("pricing").ok().flatten().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

pub fn save_pricing(store: &Store, pricing: &Pricing) -> anyhow::Result<()> {
    store.set_setting("pricing", &serde_json::to_string(pricing)?)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PricedUsage {
    #[serde(flatten)]
    pub record: UsageRecord,
    /// Reported or estimated cost; `None` when neither is possible.
    pub cost: Option<f64>,
    pub estimated: bool,
}

pub fn price(record: UsageRecord, pricing: &Pricing) -> PricedUsage {
    if let Some(cost) = record.cost_usd {
        return PricedUsage { record, cost: Some(cost), estimated: false };
    }
    // Model values can carry an effort suffix, e.g. "gpt-6-astra[high]".
    let base = record.model.split('[').next().unwrap_or(&record.model);
    let estimate = pricing.get(&record.model).or_else(|| pricing.get(base)).map(|p| {
        (record.input_tokens as f64 * p.input
            + record.cached_tokens as f64 * p.cached_input
            + record.output_tokens as f64 * p.output)
            / 1_000_000.0
    });
    PricedUsage { cost: estimate, estimated: estimate.is_some(), record }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(model: &str, cost: Option<f64>) -> UsageRecord {
        UsageRecord {
            session_id: "s".into(),
            workspace_id: "w".into(),
            repo_id: "r".into(),
            agent: "codex".into(),
            model: model.into(),
            ts: 0,
            input_tokens: 1_000_000,
            cached_tokens: 2_000_000,
            output_tokens: 100_000,
            cost_usd: cost,
        }
    }

    #[test]
    fn reported_cost_wins_and_estimates_use_prices() {
        let mut pricing = Pricing::new();
        pricing.insert("gpt-x".into(), ModelPrice { input: 2.0, cached_input: 0.5, output: 10.0 });
        assert_eq!(price(record("gpt-x", Some(0.3)), &pricing).cost, Some(0.3));
        let p = price(record("gpt-x[high]", None), &pricing);
        assert!(p.estimated);
        assert!((p.cost.unwrap() - (2.0 + 1.0 + 1.0)).abs() < 1e-9);
        assert_eq!(price(record("other", None), &pricing).cost, None);
    }
}
