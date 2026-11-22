import en from "../locales/en.json";
import ptBR from "../locales/pt-BR.json";

const dicts: Record<string, Record<string, string>> = { "pt-BR": ptBR, en };
let current = "pt-BR";

export function setLang(l: string) {
  current = dicts[l] ? l : "pt-BR";
}

/** Traduz `key`; cai para pt-BR e, por fim, para a própria chave. Aceita {var}. */
export function t(key: string, vars?: Record<string, string | number>): string {
  let s = dicts[current]?.[key] ?? dicts["pt-BR"][key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
