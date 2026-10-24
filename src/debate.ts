// Golden Kog risk debate module.
// Two advocates (sound / fragile) argue from measured facts, a reviewer weighs
// them. A risk tool, never a trading tool. Adapted from the TradingAgents
// debate pattern (TauricResearch, Apache 2.0) without its trader or portfolio
// manager. No runtime dependency; Node 22.

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
  route(args: RouteArgs): Promise<RouteResult>;
  check?(text: string): string[];
  mode?: 'off' | 'shadow' | 'on';
  log?(row: object): void;
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

const REFUSED = [
  'bull', 'bear', 'bullish', 'bearish', 'upside', 'downside target',
  'undervalued', 'overvalued', 'accumulate', 'moon', 'buy now', 'sell now',
  'price target', 'entry', 'exit', 'take profit', 'not financial advice',
];

const EMPTY_PART = 'No case could be written from the measured facts.';

const ADVOCATE_WORDS = 180;
const REVIEWER_WORDS = 150;

function numbersOf(text: string): string[] {
  return text.match(/\d+(?:[.,]\d+)*(?:%|x)?/gi) ?? [];
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function hasNonLatinDigit(text: string): boolean {
  return /[\u0660-\u0669\u06F0-\u06F9\u0966-\u096F\u09E6-\u09EF\u0A66-\u0A6F\u0AE6-\u0AEF\u0B66-\u0B6F\u0BE6-\u0BEF\u0C66-\u0C6F\u0CE6-\u0CEF\u0D66-\u0D6F\u0DE6-\u0DEF\u0E50-\u0E59\u0ED0-\u0ED9\u1040-\u1049\u17E0-\u17E9\uFF10-\uFF19]/.test(text);
}

function hasDash(text: string): boolean {
  return /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/.test(text);
}

function refusedWord(text: string): string | null {
  const low = text.toLowerCase();
  for (const w of REFUSED) {
    const re = new RegExp(`\\b${w.replace(/ /g, '\\s+')}\\b`, 'i');
    if (re.test(low)) return w;
  }
  return null;
}

function validatePart(
  text: string,
  facts_text: string,
  maxWords: number,
  check: ((t: string) => string[]) | undefined,
): string[] {
  const problems: string[] = [];
  for (const n of numbersOf(text)) {
    if (!facts_text.includes(n)) problems.push(`number not in facts: ${n}`);
  }
  const bad = refusedWord(text);
  if (bad) problems.push(`refused word: ${bad}`);
  if (hasDash(text)) problems.push('dash character present');
  if (hasNonLatinDigit(text)) problems.push('non-Latin digit present');
  if (wordCount(text) > maxWords) problems.push(`over ${maxWords} words`);
  if (check) {
    for (const p of check(text) ?? []) problems.push(p);
  }
  return problems;
}

function systemFor(role: 'sound' | 'fragile' | 'reviewer'): string {
  const base =
    'You are part of a structured risk debate for a token risk report. ' +
    'This is a risk tool, never a trading tool: argue only from the measured ' +
    'facts given. Every number you write must appear in the facts, written ' +
    'the same way. Never use trading language (no buy, sell, price target, ' +
    'entry, exit or advice). Latin digits only, no dash characters. ';
  if (role === 'sound') {
    return base + 'You argue the token structure is SOUND: cite the measured ' +
      'facts that support structural strength, acknowledge gaps honestly. ' +
      'At most 180 words.';
  }
  if (role === 'fragile') {
    return base + 'You argue the token structure is FRAGILE: cite the measured ' +
      'facts and fired risk rules that support structural weakness. ' +
      'At most 180 words.';
  }
  return base + 'You are the REVIEWER. Weigh the sound and fragile cases ' +
    'against the facts and answer ONLY JSON of the form ' +
    '{"text": string, "weight": string[], "unknown": string[], ' +
    '"tension": string}. weight holds ids from the fired risk rules that ' +
    'carry the decision. At most 150 words total.';
}

function promptFor(
  role: 'sound' | 'fragile' | 'reviewer',
  input: DebateInput,
  sound: string,
  fragile: string,
): string {
  const head =
    `Measured facts:\n${input.facts_text}\n\n` +
    `Fired risk rule ids: ${input.flag_ids.join(', ') || 'none'}\n` +
    `Known unknowns: ${input.unknown.join(', ') || 'none'}\n\n`;
  if (role === 'sound') {
    return head + 'Write the sound-structure case from these facts only.';
  }
  if (role === 'fragile') {
    return head + 'Write the fragile-structure case from these facts only.';
  }
  return head +
    `Sound case:\n${sound}\n\nFragile case:\n${fragile}\n\n` +
    'Weigh both. JSON only.';
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function callWithTimeout(
  deps: DebateDeps,
  args: RouteArgs,
  timeoutMs: number,
): Promise<RouteResult | 'timeout'> {
  const call = deps.route(args);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    const result = await Promise.race([call, timeout]);
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function emptyDebate(status: Debate['status'], shown: boolean): Debate {
  return {
    status, shown, sound: '', fragile: '', reviewer: '',
    weight: [], unknown: [], models: {}, usd: 0, rejected: [],
  };
}

export async function debate(input: DebateInput, deps: DebateDeps): Promise<Debate> {
  const mode = deps.mode ?? 'shadow';
  if (mode === 'off') return emptyDebate('off', false);

  const shown = mode === 'on';
  const timeoutMs = deps.timeoutMs ?? 45000;
  const check = deps.check;
  const out = emptyDebate('ok', shown);
  const flagSet = new Set(input.flag_ids);

  // Advocates run in parallel.
  const mkArgs = (role: 'sound' | 'fragile'): RouteArgs => {
    const system = systemFor(role);
    const prompt = promptFor(role, input, '', '');
    return {
      task_type: 'risk_debate',
      tier_class: 'text',
      complexity: 'exec',
      context_tokens: estimateTokens(system + prompt),
      constitutional_flag: false,
      agent_id: 'golden-kog',
      payload: { role, system, prompt, max_tokens: 400 },
    };
  };

  const [soundRes, fragileRes] = await Promise.all([
    callWithTimeout(deps, mkArgs('sound'), timeoutMs),
    callWithTimeout(deps, mkArgs('fragile'), timeoutMs),
  ]);

  const parts: { role: 'sound' | 'fragile'; res: RouteResult | 'timeout' }[] = [
    { role: 'sound', res: soundRes },
    { role: 'fragile', res: fragileRes },
  ];
  for (const { role, res } of parts) {
    if (res === 'timeout') {
      out.status = 'timeout';
      out.rejected.push(`${role} call timed out`);
      continue;
    }
    if (res.model) out.models[role] = res.model;
    out.usd += res.cost_usd ?? 0;
    const problems = validatePart(res.content, input.facts_text, ADVOCATE_WORDS, check);
    if (problems.length) {
      out[role] = EMPTY_PART;
      out.rejected.push(...problems.map((p) => `${role}: ${p}`));
    } else {
      out[role] = res.content;
    }
  }
  if (out.status === 'timeout') {
    out.shown = mode === 'on';
    deps.log?.(out);
    return out;
  }

  // Reviewer gets both texts and the facts.
  {
    const system = systemFor('reviewer');
    const prompt = promptFor('reviewer', input, out.sound, out.fragile);
    const args: RouteArgs = {
      task_type: 'risk_debate',
      tier_class: 'text',
      complexity: 'apex',
      context_tokens: estimateTokens(system + prompt),
      constitutional_flag: false,
      agent_id: 'golden-kog',
      payload: { role: 'reviewer', system, prompt, max_tokens: 400 },
    };
    const res = await callWithTimeout(deps, args, timeoutMs);
    if (res === 'timeout') {
      out.status = 'timeout';
      out.rejected.push('reviewer call timed out');
      out.shown = mode === 'on';
      deps.log?.(out);
      return out;
    }
    if (res.model) out.models.reviewer = res.model;
    out.usd += res.cost_usd ?? 0;

    let parsed: { text?: unknown; weight?: unknown; unknown?: unknown; tension?: unknown };
    try {
      const m = res.content.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(m ? m[0] : res.content);
    } catch {
      out.status = 'rejected';
      out.sound = '';
      out.fragile = '';
      out.rejected.push('reviewer JSON unparseable');
      out.shown = mode === 'on';
      deps.log?.(out);
      return out;
    }

    const text = typeof parsed.text === 'string' ? parsed.text : '';
    const problems = validatePart(text, input.facts_text, REVIEWER_WORDS, check);
    if (!text || problems.length) {
      out.status = 'rejected';
      out.sound = '';
      out.fragile = '';
      out.reviewer = '';
      out.rejected.push(
        ...(text ? problems : ['reviewer text missing']).map((p) => `reviewer: ${p}`),
      );
      out.shown = mode === 'on';
      deps.log?.(out);
      return out;
    }

    out.reviewer = text;
    out.weight = (Array.isArray(parsed.weight) ? parsed.weight : [])
      .filter((w): w is string => typeof w === 'string')
      .filter((w) => flagSet.has(w));
    out.unknown = (Array.isArray(parsed.unknown) ? parsed.unknown : [])
      .filter((u): u is string => typeof u === 'string');
    if (typeof parsed.tension === 'string' && parsed.tension) {
      out.tension = parsed.tension;
    }
  }

  deps.log?.(out);
  return out;
}
