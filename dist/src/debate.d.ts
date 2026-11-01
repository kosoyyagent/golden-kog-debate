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
    models: {
        sound?: string;
        fragile?: string;
        reviewer?: string;
    };
    usd: number;
    rejected: string[];
}
export declare function debate(input: DebateInput, deps: DebateDeps): Promise<Debate>;
