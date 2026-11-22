import { useEffect, useMemo, useRef, useState } from "react";
import { focusNode, saveProfiles, saveSettings } from "../actions";
import { buildCommands, matches } from "../commands";
import { api } from "../lib/ipc";
import { t } from "../lib/i18n";
import { DEFAULT_PROFILES } from "../lib/workspace";
import { setState, setUi, useStore } from "../store";
import type { AgentProfile, Settings } from "../types";

export function Modal({ title, onClose, children, wide }: { title?: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="overlay" onPointerDown={onClose}>
      <div className={`modal ${wide ? "wide" : ""}`} onPointerDown={(e) => e.stopPropagation()}>
        {title && <h3>{title}</h3>}
        {children}
      </div>
    </div>
  );
}

export function Palette() {
  const open = useStore((s) => s.ui.palette);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const cmds = useMemo(() => (open ? buildCommands() : []), [open]);
  const list = cmds.filter((c) => matches(c.title, q));
  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);
  if (!open) return null;
  const run = (i: number) => {
    const c = list[i];
    setUi({ palette: false });
    c?.run();
  };
  return (
    <Modal onClose={() => setUi({ palette: false })}>
      <input
        ref={input}
        className="big"
        placeholder={t("palette.placeholder")}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setIdx(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setIdx(Math.min(list.length - 1, idx + 1));
          else if (e.key === "ArrowUp") setIdx(Math.max(0, idx - 1));
          else if (e.key === "Enter") run(idx);
        }}
      />
      <div className="results">
        {list.length === 0 && <p className="muted">{t("palette.none")}</p>}
        {list.map((c, i) => (
          <div key={c.id} className={`result ${i === idx ? "sel" : ""}`} onMouseEnter={() => setIdx(i)} onClick={() => run(i)}>
            <span>{c.title}</span>
            {c.hint && <kbd>{c.hint}</kbd>}
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function SearchPanel() {
  const open = useStore((s) => s.ui.search);
  const ws = useStore((s) => s.ws);
  const [q, setQ] = useState("");
  const [out, setOut] = useState<{ id: string; line: string }[]>([]);
  useEffect(() => {
    if (!open || q.trim().length < 2) return setOut([]);
    const h = setTimeout(() => api.searchOutput(q).then(setOut).catch(() => setOut([])), 200);
    return () => clearTimeout(h);
  }, [q, open]);
  if (!open || !ws) return null;
  const nodes = q.trim().length < 1 ? [] : ws.nodes.filter((n) => matches(`${n.title} ${n.kind === "note" ? n.text : ""} ${n.kind === "file" ? n.path : ""}`, q));
  const go = (id: string) => {
    setUi({ search: false });
    focusNode(id);
  };
  const name = (id: string) => ws.nodes.find((n) => n.id === id)?.title ?? id;
  return (
    <Modal onClose={() => setUi({ search: false })}>
      <input autoFocus className="big" placeholder={t("search.placeholder")} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="results">
        {q && nodes.length === 0 && out.length === 0 && <p className="muted">{t("search.none")}</p>}
        {nodes.length > 0 && <div className="group">{t("search.nodes")}</div>}
        {nodes.map((n) => (
          <div key={n.id} className="result" onClick={() => go(n.id)}>
            <span>{n.title}</span>
            <kbd>{t(`node.${n.kind}`)}</kbd>
          </div>
        ))}
        {out.length > 0 && <div className="group">{t("search.output")}</div>}
        {out.map((h, i) => (
          <div key={i} className="result" onClick={() => go(h.id)}>
            <span className="mono ellipsis">{h.line}</span>
            <kbd>{name(h.id)}</kbd>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function SettingsModal() {
  const open = useStore((s) => s.ui.settings);
  const s = useStore((x) => x.settings);
  if (!open) return null;
  const set = (p: Partial<Settings>) => void saveSettings({ ...s, ...p });
  return (
    <Modal title={t("settings.title")} onClose={() => setUi({ settings: false })}>
      <div className="form">
        <label>
          {t("settings.theme")}
          <select value={s.theme} onChange={(e) => set({ theme: e.target.value as Settings["theme"] })}>
            <option value="dark">{t("settings.dark")}</option>
            <option value="light">{t("settings.light")}</option>
          </select>
        </label>
        <label>
          {t("settings.lang")}
          <select value={s.lang} onChange={(e) => set({ lang: e.target.value as Settings["lang"] })}>
            <option value="pt-BR">Português (Brasil)</option>
            <option value="en">English</option>
          </select>
        </label>
        <label>
          {t("settings.fontSize")}
          <input type="number" min={8} max={28} value={s.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) || 13 })} />
        </label>
        <label>
          {t("settings.fontFamily")}
          <input value={s.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })} />
        </label>
        <label>
          {t("settings.scrollback")}
          <input type="number" min={500} max={100000} step={500} value={s.scrollbackLines} onChange={(e) => set({ scrollbackLines: Number(e.target.value) || 5000 })} />
        </label>
        <label>
          {t("settings.memAlert")}
          <input type="number" min={100} value={s.memAlertMb} onChange={(e) => set({ memAlertMb: Number(e.target.value) || 1500 })} />
        </label>
        <label className="check">
          <input type="checkbox" checked={s.snap} onChange={(e) => set({ snap: e.target.checked })} /> {t("settings.snap")}
        </label>
        <label>
          {t("settings.grid")}
          <input type="number" min={8} max={80} value={s.grid} onChange={(e) => set({ grid: Number(e.target.value) || 20 })} />
        </label>
        <label className="check">
          <input type="checkbox" checked={s.notifications} onChange={(e) => set({ notifications: e.target.checked })} /> {t("settings.notifications")}
        </label>
      </div>
    </Modal>
  );
}

export function ProfilesModal() {
  const open = useStore((s) => s.ui.profiles);
  const profiles = useStore((s) => s.profiles);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [found, setFound] = useState<Record<string, string | null>>({});
  useEffect(() => {
    if (open) {
      setText(JSON.stringify(profiles, null, 2));
      setErr("");
      setFound({});
    }
  }, [open, profiles]);
  if (!open) return null;
  const parse = (): AgentProfile[] | null => {
    try {
      const v = JSON.parse(text);
      if (!Array.isArray(v) || !v.every((p) => p && typeof p.id === "string" && typeof p.name === "string" && typeof p.command === "string")) throw new Error("array de perfis com id, name e command");
      const norm = v.map((p) => ({ args: [], env: {}, resumeArgs: [], waitPatterns: [], color: "#8b93a7", paste: false, ...p })) as AgentProfile[];
      setErr("");
      return norm;
    } catch (e) {
      setErr(t("profiles.invalid", { error: String(e instanceof Error ? e.message : e) }));
      return null;
    }
  };
  const detect = async () => {
    const p = parse();
    if (!p) return;
    setFound(await api.detect(p.filter((x) => x.command).map((x) => x.command)));
  };
  return (
    <Modal title={t("profiles.title")} onClose={() => setUi({ profiles: false })} wide>
      <p className="muted small">{t("profiles.hint")}</p>
      <textarea className="json" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      {err && <p className="warn small">{err}</p>}
      {Object.keys(found).length > 0 && (
        <div className="small">
          {Object.entries(found).map(([c, p]) => (
            <div key={c} className={p ? "ok" : "warn"}>
              {c}: {p ? `${t("profiles.found")} (${p})` : t("profiles.missing")}
            </div>
          ))}
        </div>
      )}
      <div className="inline end">
        <button onClick={() => setText(JSON.stringify(DEFAULT_PROFILES, null, 2))}>Padrões</button>
        <button onClick={() => void detect()}>{t("profiles.detect")}</button>
        <button
          className="primary"
          onClick={() => {
            const p = parse();
            if (p) void saveProfiles(p).then(() => setUi({ profiles: false }));
          }}
        >
          {t("profiles.save")}
        </button>
      </div>
    </Modal>
  );
}

function PromptBody({ p }: { p: NonNullable<import("../store").Ui["prompt"]> }) {
  const [v, setV] = useState(p.initial);
  const ref = useRef<HTMLInputElement>(null);
  // O valor inicial já está no DOM ao montar: foca e seleciona tudo para substituir direto.
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <Modal title={p.title} onClose={() => p.resolve(null)}>
      <input ref={ref} className="big" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && p.resolve(v)} />
      <div className="inline end">
        <button onClick={() => p.resolve(null)}>{t("common.cancel")}</button>
        <button className="primary" onClick={() => p.resolve(v)}>
          {t("common.ok")}
        </button>
      </div>
    </Modal>
  );
}

export function PromptModal() {
  const p = useStore((s) => s.ui.prompt);
  return p ? <PromptBody key={p.title + p.initial} p={p} /> : null;
}

export function ConfirmModal() {
  const c = useStore((s) => s.confirm);
  if (!c) return null;
  const answer = (allow: boolean) => {
    void api.confirmAnswer(c.id, allow);
    setState({ confirm: null });
  };
  return (
    <Modal title={t("confirm.title")} onClose={() => answer(false)}>
      <p>{t("confirm.text", { from: c.fromName, to: c.toName })}</p>
      <pre className="quote">{c.body}</pre>
      <div className="inline end">
        <button onClick={() => answer(false)}>{t("confirm.deny")}</button>
        <button className="primary" onClick={() => answer(true)}>
          {t("confirm.allow")}
        </button>
      </div>
    </Modal>
  );
}
