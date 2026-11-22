import { describe, expect, it } from "vitest";
import { isDue, nextRun, sanitizeRoutine, STALE_MS } from "./routines";
import type { Routine } from "../types";

const base: Routine = { id: "r1", termId: "t1", title: "x", text: "oi", kind: "every", everyMin: 10, enabled: true, runs: 0, createdAt: new Date(2026, 10, 22, 8, 0).getTime() };
const at = (h: number, m = 0, day = 22) => new Date(2026, 10, day, h, m, 0, 0);

describe("rotinas: isDue", () => {
  it("intervalo: dispara só depois do período, contado do último disparo", () => {
    expect(isDue(base, at(8, 9))).toBe(false);
    expect(isDue(base, at(8, 10))).toBe(true);
    expect(isDue({ ...base, lastRun: at(9, 0).getTime() }, at(9, 5))).toBe(false);
    expect(isDue({ ...base, lastRun: at(9, 0).getTime() }, at(9, 10))).toBe(true);
  });
  it("desligada ou com limite de execuções atingido não dispara", () => {
    expect(isDue({ ...base, enabled: false }, at(12))).toBe(false);
    expect(isDue({ ...base, maxRuns: 3, runs: 3 }, at(12))).toBe(false);
    expect(isDue({ ...base, maxRuns: 3, runs: 2 }, at(12))).toBe(true);
  });
  it("única: dispara uma vez, após o horário", () => {
    const r: Routine = { ...base, kind: "once", at: at(10).getTime() };
    expect(isDue(r, at(9, 59))).toBe(false);
    expect(isDue(r, at(10, 1))).toBe(true);
    expect(isDue({ ...r, runs: 1 }, at(10, 1))).toBe(false);
  });
  it("diária: no horário, uma vez por dia, e descarta ocorrência perdida há muito tempo", () => {
    const r: Routine = { ...base, kind: "daily", time: "09:00" };
    expect(isDue(r, at(8, 59))).toBe(false);
    expect(isDue(r, at(9, 1))).toBe(true);
    expect(isDue({ ...r, lastRun: at(9, 0, 22).getTime() }, at(9, 30))).toBe(false);
    expect(isDue({ ...r, lastRun: at(9, 0, 21).getTime() }, at(9, 30))).toBe(true);
    expect(isDue(r, new Date(at(9).getTime() + STALE_MS + 60_000))).toBe(false);
  });
  it("semanal: só no dia da semana configurado", () => {
    const dow = at(9).getDay(); // 22/11/2026
    const r: Routine = { ...base, kind: "weekly", time: "09:00", weekday: dow };
    expect(isDue(r, at(9, 5))).toBe(true);
    expect(isDue({ ...r, weekday: (dow + 1) % 7 }, at(9, 5))).toBe(false);
  });
});

describe("rotinas: nextRun e sanitizeRoutine", () => {
  it("nextRun calcula o próximo disparo", () => {
    expect(nextRun(base, at(8, 1))).toBe(base.createdAt + 10 * 60_000);
    expect(nextRun({ ...base, enabled: false }, at(8))).toBeNull();
    const d: Routine = { ...base, kind: "daily", time: "09:00" };
    expect(nextRun(d, at(8))).toBe(at(9).getTime());
    expect(nextRun({ ...d, lastRun: at(9).getTime() }, at(10))).toBe(at(9, 0, 23).getTime());
    expect(nextRun({ ...base, kind: "once", at: at(10).getTime(), runs: 1 }, at(8))).toBeNull();
  });
  it("sanitizeRoutine rejeita lixo, normaliza e pode desligar (importação)", () => {
    expect(sanitizeRoutine(null)).toBeNull();
    expect(sanitizeRoutine({ id: "a", termId: "t", kind: "inventada" })).toBeNull();
    const r = sanitizeRoutine({ id: "a", termId: "t", kind: "daily", time: "99:99", everyMin: -5, weekday: 40, enabled: true, preRun: "git status", maxRuns: 0 })!;
    expect(r.time).toBe("09:00");
    expect(r.everyMin).toBe(1);
    expect(r.weekday).toBe(6);
    expect(r.maxRuns).toBeUndefined();
    expect(r.enabled).toBe(true);
    expect(sanitizeRoutine({ id: "a", termId: "t", kind: "every", enabled: true, preRun: "calc.exe" }, true)!.enabled).toBe(false);
  });
});
