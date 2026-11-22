import type { AgentProfile } from "../types";

/** Aspas simples do PowerShell: ' vira ''. */
export function psQuote(arg: string): string {
  if (/^[A-Za-z0-9_\-.:\\/=+,@]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "''")}'`;
}

export interface SpawnPlan {
  program: string;
  args: string[];
}

/**
 * Agentes rodam dentro do shell do usuário (`-NoExit`): assim o PATH, os atalhos .cmd/.ps1 e os
 * aliases funcionam, e o terminal continua útil depois que o agente encerra.
 */
export function buildSpawnPlan(profile: AgentProfile, shell: string, resume: boolean): SpawnPlan {
  const isPs = /pwsh|powershell/i.test(shell);
  if (!profile.command.trim()) return { program: shell, args: isPs ? ["-NoLogo"] : [] };
  const parts = [profile.command, ...profile.args, ...(resume ? profile.resumeArgs : [])];
  if (isPs) {
    const [cmd, ...rest] = parts;
    const head = /^[A-Za-z0-9_\-.]+$/.test(cmd) ? cmd : `& ${psQuote(cmd)}`;
    return { program: shell, args: ["-NoLogo", "-NoExit", "-Command", [head, ...rest.map(psQuote)].join(" ")] };
  }
  return { program: shell, args: ["-c", parts.map((p) => `'${p.replace(/'/g, "'\\''")}'`).join(" ") + "; exec $SHELL"] };
}

/** Quantas colunas/linhas cabem em (w x h) pixels de mundo, dado o tamanho da fonte base. */
export function gridFor(w: number, h: number, fontSize: number, lineHeight = 1.2) {
  const cellW = fontSize * 0.6;
  const cellH = Math.ceil(fontSize * lineHeight);
  return { cols: Math.max(10, Math.floor((w - 12) / cellW)), rows: Math.max(2, Math.floor((h - 8) / cellH)), cellW, cellH };
}
