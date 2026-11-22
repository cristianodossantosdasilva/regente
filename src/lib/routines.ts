import type { Routine } from "../types";

/** Tolerância para rotinas diárias/semanais "perdidas" (app fechado): além disso, a ocorrência é descartada. */
export const STALE_MS = 2 * 3600_000;

function atTime(base: Date, time: string): Date {
  const [h, m] = time.split(":").map((x) => Number(x));
  const d = new Date(base);
  d.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
  return d;
}

/** A rotina deve disparar agora? Função pura (a hora vem de fora) para ser testável. */
export function isDue(r: Routine, now: Date): boolean {
  if (!r.enabled) return false;
  if (r.maxRuns && r.runs >= r.maxRuns) return false;
  const t = now.getTime();
  switch (r.kind) {
    case "every":
      return t - (r.lastRun ?? r.createdAt) >= Math.max(1, r.everyMin ?? 60) * 60_000;
    case "once":
      return r.runs === 0 && !!r.at && t >= r.at;
    case "daily":
    case "weekly": {
      if (r.kind === "weekly" && now.getDay() !== (r.weekday ?? 1)) return false;
      const sched = atTime(now, r.time ?? "09:00").getTime();
      return t >= sched && t - sched <= STALE_MS && (r.lastRun ?? 0) < sched;
    }
  }
}

/** Próximo disparo previsto (epoch ms) ou null (ex.: rotina única já executada, limite atingido, desligada). */
export function nextRun(r: Routine, now: Date): number | null {
  if (!r.enabled || (r.maxRuns && r.runs >= r.maxRuns)) return null;
  switch (r.kind) {
    case "every":
      return (r.lastRun ?? r.createdAt) + Math.max(1, r.everyMin ?? 60) * 60_000;
    case "once":
      return r.runs === 0 && r.at ? r.at : null;
    case "daily":
    case "weekly": {
      for (let i = 0; i < 8; i++) {
        const day = new Date(now);
        day.setDate(day.getDate() + i);
        if (r.kind === "weekly" && day.getDay() !== (r.weekday ?? 1)) continue;
        const sched = atTime(day, r.time ?? "09:00");
        if (sched.getTime() > now.getTime() || (i === 0 && (r.lastRun ?? 0) < sched.getTime())) return sched.getTime();
      }
      return null;
    }
  }
}

/** Normaliza uma rotina vinda de disco/importação (campos inválidos viram padrões; vem sempre desligada se `disable`). */
export function sanitizeRoutine(raw: unknown, disable = false): Routine | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const kinds = ["every", "daily", "weekly", "once"];
  if (typeof r.id !== "string" || typeof r.termId !== "string" || !kinds.includes(r.kind as string)) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(str(r.time)) ? str(r.time) : "09:00";
  return {
    id: r.id,
    termId: r.termId,
    title: str(r.title, "Rotina").slice(0, 80),
    text: str(r.text).slice(0, 4000),
    kind: r.kind as Routine["kind"],
    everyMin: Math.max(1, Math.min(10080, num(r.everyMin) ?? 60)),
    time,
    weekday: Math.max(0, Math.min(6, Math.floor(num(r.weekday) ?? 1))),
    at: num(r.at),
    enabled: disable ? false : r.enabled === true,
    preRun: str(r.preRun).slice(0, 2000) || undefined,
    reminder: r.reminder === true,
    maxRuns: num(r.maxRuns) && (num(r.maxRuns) as number) > 0 ? Math.floor(num(r.maxRuns) as number) : undefined,
    runs: Math.max(0, Math.floor(num(r.runs) ?? 0)),
    lastRun: num(r.lastRun),
    createdAt: num(r.createdAt) ?? Date.now(),
  };
}
