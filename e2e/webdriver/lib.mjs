// Cliente mínimo do protocolo W3C WebDriver (sem dependências), para o E2E no Linux/macOS via `tauri-driver`.
// O WebView2 do Windows aceita o DevTools Protocol (puppeteer); o WebKit não, então Linux/macOS usam WebDriver.
const BASE = process.env.WD_URL ?? "http://127.0.0.1:4444";

async function wd(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok || j.value?.error) throw new Error(`${method} ${path}: ${j.value?.error ?? r.status} ${j.value?.message ?? ""}`.slice(0, 400));
  return j.value;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const ENTER = "";
export const ROOT = process.env.E2E_ROOT ?? process.env.HOME ?? "/tmp";

export class Session {
  constructor(id) {
    this.id = id;
  }
  static async start(application) {
    const v = await wd("POST", "/session", { capabilities: { alwaysMatch: { "tauri:options": { application } } } });
    return new Session(v.sessionId);
  }
  req(method, path, body) {
    return wd(method, `/session/${this.id}${path}`, body);
  }
  exec(script, args = []) {
    return this.req("POST", "/execute/sync", { script, args });
  }
  async find(css) {
    const v = await this.req("POST", "/element", { using: "css selector", value: css });
    return Object.values(v)[0];
  }
  async has(css) {
    const v = await this.req("POST", "/elements", { using: "css selector", value: css });
    return v.length > 0;
  }
  click(el) {
    return this.req("POST", `/element/${el}/click`, {});
  }
  keys(el, text) {
    return this.req("POST", `/element/${el}/value`, { text });
  }
  setWindow(width, height) {
    return this.req("POST", "/window/rect", { width, height });
  }
  /** Clica no primeiro elemento de `selector` cujo texto contém `text`. */
  clickText(text, selector = "button") {
    return this.exec("const [t,s]=arguments; const e=[...document.querySelectorAll(s)].find((b)=>b.textContent.includes(t)); if(e) e.click(); return !!e;", [text, selector]);
  }
  /** Seleciona uma opção de <select> disparando o evento que o React escuta. */
  selectValue(css, value) {
    return this.exec(
      "const [c,v]=arguments; const s=document.querySelector(c); const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; setter.call(s,v); s.dispatchEvent(new Event('change',{bubbles:true}));",
      [css, value],
    );
  }
  /** Dispara um atalho de teclado na janela (ex.: Ctrl+K). */
  shortcut(key, opts = {}) {
    return this.exec("const [k,o]=arguments; window.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true,...o}));", [key, opts]);
  }
  nodeTitles() {
    return this.exec("return [...document.querySelectorAll('.node .title')].map((e)=>e.textContent);");
  }
  /** Texto visível do terminal do nó com este título (junta as linhas visuais). */
  termText(title) {
    return this.exec(
      "const t=arguments[0]; const n=[...document.querySelectorAll('.node')].find((x)=>x.querySelector('.title')?.textContent===t); const r=n&&n.querySelector('.xterm-rows'); return r? r.innerText.replace(/\\u00a0/g,' ').replace(/\\r?\\n/g,'') : '';",
      [title],
    );
  }
  /** Digita no terminal do nó com este título e aperta Enter. */
  async typeIn(title, text) {
    const ok = await this.exec(
      "const t=arguments[0]; const n=[...document.querySelectorAll('.node')].find((x)=>x.querySelector('.title')?.textContent===t); const a=n&&n.querySelector('.xterm-helper-textarea'); if(a) a.focus(); return !!a;",
      [title],
    );
    if (!ok) throw new Error(`terminal não visível (dormente?): ${title}`);
    const active = await this.exec("return document.activeElement;");
    await this.keys(Object.values(active)[0], text + ENTER);
  }
  /** Elemento (input/textarea/select) do formulário do modal cujo rótulo contém o texto. */
  async fieldByLabel(fragment) {
    const r = await this.exec(
      "const f=arguments[0]; const l=[...document.querySelectorAll('.modal .form label')].find((x)=>x.textContent.includes(f)); return l? l.querySelector('input,textarea,select') : null;",
      [fragment],
    );
    return r ? Object.values(r)[0] : null;
  }
  /** Abre a paleta (Ctrl+K), digita a busca e executa o primeiro resultado. */
  async palette(query) {
    await this.shortcut("k", { ctrlKey: true });
    await sleep(500);
    await this.keys(await this.find(".modal .big"), query + ENTER);
    await sleep(700);
  }
  /** Cria um workspace pela aba Workspaces e espera o canvas. */
  async createWorkspace(name, root) {
    await this.clickText("Workspaces", ".tabs button");
    await sleep(300);
    await this.keys(await this.find('.form input[placeholder="Nome"]'), name);
    await this.keys(await this.find(".form .inline input"), root);
    await this.clickText("Criar", "button.primary");
    await waitFor(() => this.has(".canvas"));
    await sleep(800);
  }
  toastText() {
    return this.exec("return document.querySelector('.toast')?.textContent ?? '';");
  }
  /** Aguarda o prompt do shell voltar (o broker envia o Enter ~180 ms depois de injetar uma mensagem). */
  atPrompt(title) {
    return waitFor(async () => (/[$#]\s*$/.test(await this.termText(title)) ? true : null), 10000);
  }
  async close() {
    try {
      await this.req("DELETE", "");
    } catch {
      /* já fechou */
    }
  }
}

export async function waitFor(fn, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(300);
  }
  return null;
}

export function reporter() {
  const results = [];
  return {
    check(name, ok, extra = "") {
      results.push({ name, ok });
      console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  -> " + String(extra).slice(0, 200) : ""}`);
    },
    done() {
      const failed = results.filter((r) => !r.ok);
      console.log(`\n${results.length - failed.length}/${results.length} verificações OK`);
      return failed.length ? 1 : 0;
    },
  };
}
