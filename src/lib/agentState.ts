import type { AgentProfile, AgentState, TermStat } from "../types";

/** Saída recente há menos que isso = "trabalhando". */
export const WORKING_MS = 1500;

export function compilePatterns(profile?: Pick<AgentProfile, "waitPatterns">): RegExp[] {
  const out: RegExp[] = [];
  for (const p of profile?.waitPatterns ?? []) {
    try {
      out.push(new RegExp(p, "i"));
    } catch {
      /* padrão inválido é ignorado */
    }
  }
  return out;
}

/**
 * Heurística de estado por atividade de saída e processo (não é infalível:
 * "aguardando" depende dos padrões do perfil — ver ADR-0001).
 */
export function computeState(stat: Pick<TermStat, "alive" | "exitCode" | "idleMs" | "tail">, patterns: RegExp[]): AgentState {
  if (!stat.alive) return stat.exitCode === 0 || stat.exitCode === null ? "exited" : "error";
  if (stat.idleMs < WORKING_MS) return "working";
  const tail = stat.tail.slice(-400);
  if (patterns.some((r) => r.test(tail))) return "waiting";
  return "idle";
}
