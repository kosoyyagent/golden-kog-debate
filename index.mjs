// Golden Kog risk debate: two advocates argue from measured facts, a reviewer
// weighs them. A risk tool, never a trading tool - no buy/sell, no targets.
// Adapted from the TradingAgents debate pattern (TauricResearch, Apache 2.0).
// Node 22, zero dependencies.

// facts: {holder_concentration_pct, liquidity_usd, top10_pct, contract_flags[],
//         fee_usd, days_live} - all measured, all citeable.
export function runDebate(facts = {}) {
  const cite = (field, claim) => ({ field, value: facts[field], claim });
  const bullish = [], fragile = [];

  const c = facts.holder_concentration_pct ?? 100;
  if (c < 15) bullish.push(cite('holder_concentration_pct', `holder concentration ${c}% is low - no single wallet dominates`));
  else fragile.push(cite('holder_concentration_pct', `holder concentration ${c}% is elevated - a single cohort can move the market`));

  const liq = facts.liquidity_usd ?? 0;
  if (liq > 100_000) bullish.push(cite('liquidity_usd', `liquidity $${liq} supports orderly exits`));
  else fragile.push(cite('liquidity_usd', `liquidity $${liq} is thin - exits move price sharply`));

  const top10 = facts.top10_pct ?? 100;
  if (top10 < 30) bullish.push(cite('top10_pct', `top-10 hold ${top10}% - broad distribution`));
  else fragile.push(cite('top10_pct', `top-10 hold ${top10}% - concentrated supply`));

  const flags = facts.contract_flags || [];
  if (flags.length === 0) bullish.push(cite('contract_flags', 'no contract-level flags observed'));
  for (const f of flags) fragile.push(cite('contract_flags', `contract flag observed: ${f}`));

  if ((facts.days_live ?? 0) > 90) bullish.push(cite('days_live', `contract live ${facts.days_live} days - surviving code`));
  else fragile.push(cite('days_live', `only ${facts.days_live ?? 0} days live - unproven history`));

  // reviewer: confidence from signal balance and fact coverage
  const total = bullish.length + fragile.length || 1;
  const balance = Math.abs(bullish.length - fragile.length) / total;
  const coverage = Math.min(1, total / 5);
  const confidence = +(balance * 0.6 + coverage * 0.4).toFixed(2);
  const verdict = {
    sound_claims: bullish.length,
    fragile_claims: fragile.length,
    summary: bullish.length > fragile.length
      ? 'measured facts lean toward a sound structure, subject to the fragile points raised'
      : fragile.length > bullish.length
        ? 'measured facts lean toward a fragile structure'
        : 'measured facts are evenly split',
    confidence,
  };
  return { for: bullish, against: fragile, verdict };
}
