/**
 * debate.ts — two-sided structure debate for token risk analysis (Golden Kog).
 *
 * A "sound" advocate and a "fragile" advocate each argue a token's structure
 * from measured facts only; a reviewer weighs both and keeps the risk
 * framing. This is a risk tool, never a trading tool: no buy/sell view,
 * no price target, no entry/exit, no advice.
 *
 * Pattern adapted from TradingAgents (TauricResearch, Apache 2.0):
 * https://github.com/TauricResearch/TradingAgents
 */

export interface DebateInput {
  facts_text: string;
  level: string;
  points: number;
  flag_ids: string[];
  unknown: string[];
}

export interface RouteArgs {
  task_type: 'risk_debate';
  tier_class: 'text';
  complexity: 'exec' | 'apex';
  context_tokens: number;
  constitutional_flag: false;
  agent_id: 'golden-kog';
  payload: {
    role: 'sound' | 'fragile' | 'reviewer';
    system: string;
    prompt: string;
    max_tokens: number;
  };
}

export interface RouteResult {
  content: string;
  model?: string;
  cost_usd?: number;
}

export interface DebateDeps {
  route: (args: RouteArgs) => Promise<RouteResult>;
  check?: (text: string) => string[];
  mode?: 'off' | 'shadow' | 'on';
  log?: (row: object) => void;
  timeoutMs?: number;
}

export interface Debate {
  status: 'ok' | 'rejected' | 'timeout' | 'off';
  shown: boolean;
  sound: string;
  fragile: string;
  reviewer: string;
  weight: string[];
  unknown: string[];
  tension?: string;
  models: { sound?: string; fragile?: string; reviewer?: string };
  usd: number;
  rejected: string[];
}

const FALLBACK = 'No case could be written from the measured facts.';
const AGENT_ID = 'golden-kog' as const;
const ADVOCATE_WORD_LIMIT = 180;
const REVIEWER_WORD_LIMIT = 150;

const FORBIDDEN_WORDS = [
  'bull', 'bear', 'bullish', 'bearish', 'upside', 'downside target',
  'undervalued', 'overvalued', 'accumulate', 'moon', 'buy now', 'sell now',
  'price target', 'entry', 'exit', 'take profit', 'not financial advice',
];

const LONG_DASHES = /[\u2013\u2014\u2015\u2212]/;
const NON_LATIN_DIGIT = /[\p{Nd}\p{No}]/u; // checked after stripping ASCII digits
const ASCII_NUMBER = /\d[\d.,]*\d|\d/g;

const SOUND_SYSTEM =
  'You are the sound-structure advocate in a token risk debate. ' +
  'Argue, from the measured facts only, why the token structure is sound. ' +
  'Use only facts present in the facts block and only numbers written exactly as they appear there. ' +
  'Never give a trading view: no direction call, no target, no entry or exit, no advice. ' +
  'Write at most 180 words. Latin digits only, no long dashes.';

const FRAGILE_SYSTEM =
  'You are the fragile-structure advocate in a token risk debate. ' +
  'Argue, from the measured facts only, why the token structure is fragile. ' +
  'Use only facts present in the facts block and only numbers written exactly as they appear there. ' +
  'Never give a trading view: no direction call, no target, no entry or exit, no advice. ' +
  'Write at most 180 words. Latin digits only, no long dashes.';

const REVIEWER_SYSTEM =
  'You are the reviewer of a two-sided token structure debate. ' +
  'Weigh the sound and fragile cases against the measured facts and write the risk reading. ' +
  'Use only facts and numbers that appear in the facts block, written the same way. ' +
  'Never give a trading view: no direction call, no target, no entry or exit, no advice. ' +
  'Write at most 150 words. Latin digits only, no long dashes. ' +
  'Answer with strict JSON only: {"text": string, "weight": string[], "unknown": string[], "tension"?: string}. ' +
  'weight holds only risk flag ids from the given list; unknown holds open questions.';

function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function validatePart(
  text: string,
  factsText: string,
  wordLimit: number,
  check?: (t: string) => string[],
): string[] {
  const reasons: string[] = [];

  for (const m of text.match(ASCII_NUMBER) ?? []) {
    const num = m.replace(/^[.,]+|[.,]+$/g, '');
    if (num.length > 0 && !factsText.includes(num)) {
      reasons.push(`number not in facts_text: ${num}`);
    }
  }

  const lower = text.toLowerCase();
  for (const w of FORBIDDEN_WORDS) {
    const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(lower)) reasons.push(`refused term: ${w}`);
  }

  if (LONG_DASHES.test(text)) reasons.push('long dash character');
  if (NON_LATIN_DIGIT.test(text.replace(/[0-9]/g, ''))) reasons.push('non Latin digit');
  if (countWords(text) > wordLimit) {
    reasons.push(`over ${wordLimit} words (${countWords(text)})`);
  }

  if (check) {
    for (const p of check(text) ?? []) reasons.push(`deps.check: ${p}`);
  }
  return reasons;
}

class TimeoutError extends Error {
  constructor() {
    super('route call exceeded timeoutMs');
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError()), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

function routeCall(
  deps: DebateDeps,
  role: 'sound' | 'fragile' | 'reviewer',
  system: string,
  prompt: string,
  maxTokens: number,
): Promise<RouteResult> {
  return deps.route({
    task_type: 'risk_debate',
    tier_class: 'text',
    complexity: role === 'reviewer' ? 'apex' : 'exec',
    context_tokens: approxTokens(system + prompt),
    constitutional_flag: false,
    agent_id: AGENT_ID,
    payload: { role, system, prompt, max_tokens: maxTokens },
  });
}

interface ReviewerOut {
  text: string;
  weight: string[];
  unknown: string[];
  tension?: string;
}

function parseReviewer(content: string): ReviewerOut | null {
  let s = content.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const brace = s.indexOf('{');
  if (brace === -1) return null;
  const end = s.lastIndexOf('}');
  if (end <= brace) return null;
  try {
    const o = JSON.parse(s.slice(brace, end + 1));
    if (typeof o !== 'object' || o === null) return null;
    if (typeof o.text !== 'string' || o.text.trim().length === 0) return null;
    return {
      text: o.text,
      weight: Array.isArray(o.weight) ? o.weight.filter((x: unknown) => typeof x === 'string') : [],
      unknown: Array.isArray(o.unknown) ? o.unknown.filter((x: unknown) => typeof x === 'string') : [],
      tension: typeof o.tension === 'string' ? o.tension : undefined,
    };
  } catch {
    return null;
  }
}

function emptyDebate(status: Debate['status'], rejected: string[]): Debate {
  return {
    status,
    shown: false,
    sound: '',
    fragile: '',
    reviewer: '',
    weight: [],
    unknown: [],
    models: {},
    usd: 0,
    rejected,
  };
}

export async function debate(input: DebateInput, deps: DebateDeps): Promise<Debate> {
  const mode = deps.mode ?? 'shadow';
  const timeoutMs = deps.timeoutMs ?? 45000;
  const rejected: string[] = [];

  if (mode === 'off') {
    const d = emptyDebate('off', rejected);
    d.unknown = [...input.unknown];
    return d;
  }

  const shown = mode === 'on';
  const models: Debate['models'] = {};
  let usd = 0;

  const advocatePrompt = (side: 'sound' | 'fragile') =>
    `Facts:\n${input.facts_text}\n\n` +
    `Risk flags that fired: ${input.flag_ids.join(', ') || 'none'}.\n` +
    `Open unknowns: ${input.unknown.join(', ') || 'none'}.\n` +
    `Argue the ${side} case for the token structure, from the measured facts only.`;

  // Advocates run in parallel.
  let soundRes: RouteResult | undefined;
  let fragileRes: RouteResult | undefined;
  let anyTimeout = false;

  const settled = await Promise.allSettled([
    withTimeout(routeCall(deps, 'sound', SOUND_SYSTEM, advocatePrompt('sound'), 400), timeoutMs),
    withTimeout(routeCall(deps, 'fragile', FRAGILE_SYSTEM, advocatePrompt('fragile'), 400), timeoutMs),
  ]);

  for (let i = 0; i < 2; i++) {
    const r = settled[i];
    const role = i === 0 ? 'sound' : 'fragile';
    if (r.status === 'fulfilled') {
      if (i === 0) soundRes = r.value; else fragileRes = r.value;
      usd += r.value.cost_usd ?? 0;
      if (r.value.model) models[role] = r.value.model;
    } else if (r.reason instanceof TimeoutError) {
      anyTimeout = true;
      rejected.push(`${role} call timeout`);
    } else {
      rejected.push(`${role} call failed: ${String(r.reason).slice(0, 160)}`);
    }
  }

  if (anyTimeout) {
    const d = emptyDebate('timeout', rejected);
    d.usd = usd;
    d.models = models;
    d.unknown = [...input.unknown];
    if (mode === 'shadow') deps.log?.(d);
    d.shown = shown;
    return d;
  }

  const sound = soundRes?.content ?? '';
  const fragile = fragileRes?.content ?? '';

  const finalSound = soundRes === undefined
    ? FALLBACK
    : (() => {
        const rs = validatePart(sound, input.facts_text, ADVOCATE_WORD_LIMIT, deps.check);
        rs.forEach((x) => rejected.push(`sound: ${x}`));
        return rs.length ? FALLBACK : sound;
      })();

  const finalFragile = fragileRes === undefined
    ? FALLBACK
    : (() => {
        const rs = validatePart(fragile, input.facts_text, ADVOCATE_WORD_LIMIT, deps.check);
        rs.forEach((x) => rejected.push(`fragile: ${x}`));
        return rs.length ? FALLBACK : fragile;
      })();

  // Reviewer sees both advocate texts and the facts.
  const reviewerPrompt =
    `Facts:\n${input.facts_text}\n\n` +
    `Risk flags that fired: ${input.flag_ids.join(', ') || 'none'}.\n\n` +
    `Sound case:\n${finalSound}\n\nFragile case:\n${finalFragile}\n\n` +
    'Weigh the two cases and answer with the strict JSON only.';

  let reviewerRes: RouteResult | undefined;
  try {
    reviewerRes = await withTimeout(
      routeCall(deps, 'reviewer', REVIEWER_SYSTEM, reviewerPrompt, 500),
      timeoutMs,
    );
    usd += reviewerRes.cost_usd ?? 0;
    if (reviewerRes.model) models.reviewer = reviewerRes.model;
  } catch (e) {
    if (e instanceof TimeoutError) {
      const d = emptyDebate('timeout', [...rejected, 'reviewer call timeout']);
      d.usd = usd; d.models = models; d.unknown = [...input.unknown];
      if (mode === 'shadow') deps.log?.(d);
      d.shown = shown;
      return d;
    }
    rejected.push(`reviewer call failed: ${String(e).slice(0, 160)}`);
  }

  if (reviewerRes === undefined) {
    const d = emptyDebate('rejected', rejected);
    d.usd = usd; d.models = models; d.unknown = [...input.unknown];
    if (mode === 'shadow') deps.log?.(d);
    d.shown = shown;
    return d;
  }

  const parsed = parseReviewer(reviewerRes.content);
  if (!parsed) {
    const d = emptyDebate('rejected', [...rejected, 'reviewer output unparseable']);
    d.usd = usd; d.models = models; d.unknown = [...input.unknown];
    if (mode === 'shadow') deps.log?.(d);
    d.shown = shown;
    return d;
  }

  const rReasons = validatePart(parsed.text, input.facts_text, REVIEWER_WORD_LIMIT, deps.check);
  if (rReasons.length) {
    const d = emptyDebate('rejected', [...rejected, ...rReasons.map((x) => `reviewer: ${x}`)]);
    d.usd = usd; d.models = models; d.unknown = [...input.unknown];
    if (mode === 'shadow') deps.log?.(d);
    d.shown = shown;
    return d;
  }

  const knownFlags = new Set(input.flag_ids);
  const weight = parsed.weight.filter((id) => knownFlags.has(id));
  const unknown = [...new Set([...input.unknown, ...parsed.unknown])];

  const d: Debate = {
    status: 'ok',
    shown,
    sound: finalSound,
    fragile: finalFragile,
    reviewer: parsed.text,
    weight,
    unknown,
    tension: parsed.tension,
    models,
    usd,
    rejected,
  };
  if (mode === 'shadow') deps.log?.(d);
  return d;
}
