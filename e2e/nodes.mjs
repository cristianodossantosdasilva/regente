import { execSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { connect, OUT, shot, sleep, ROOT } from "./lib.mjs";

// repositório git temporário (para git info + worktree) e servidor http local (para o nó Navegador)
const repo = path.join(OUT, "tmp-repo").replace(/\\/g, "/");
fs.rmSync(repo, { recursive: true, force: true });
fs.rmSync(repo + "-wt-ideia-x", { recursive: true, force: true });
fs.mkdirSync(repo, { recursive: true });
fs.writeFileSync(repo + "/README.md", "# Titulo do Readme\n\nTexto **forte** e `codigo`.\n");
fs.writeFileSync(repo + "/exemplo.ts", 'const x: number = 42; // comentario\nexport function f() { return "ok"; }\n');
execSync("git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -qm init", { cwd: repo });
const server = http.createServer((_, res) => { res.setHeader("content-type", "text/html"); res.end("<h1 id=ok>Servidor local OK</h1>"); }).listen(8123);

const { browser, page } = await connect();
const results = [];
const check = (n, ok, x = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${x ? "  -> " + x : ""}`); };
const clickBtn = (t, sc = "button") => page.evaluate((t, sc) => [...document.querySelectorAll(sc)].find((b) => b.textContent.includes(t))?.click(), t, sc);
const waitFor = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(250); } return null; };
const nodeTitles = () => page.$$eval(".node .title", (e) => e.map((x) => x.textContent));
const fit = async () => { await page.keyboard.down("Control"); await page.keyboard.press("1"); await page.keyboard.up("Control"); await sleep(700); };

// workspace novo apontando para o repositório
await clickBtn("Workspaces", ".tabs button");
await sleep(300);
await page.type('.form input[placeholder="Nome"]', "Visual");
await page.type(".form .inline input", repo);
await clickBtn("Criar", "button.primary");
await waitFor(async () => (await page.$$(".node")).length === 0 && (await page.$(".canvas")));
await sleep(800);

// ---- Nota (markdown)
await clickBtn("Nota", ".toolbar button");
await sleep(400);
await page.type(".note textarea", "# Titulo da nota\n\n- item A\n- item B");
await clickBtn("Visualizar", ".note-bar button");
await sleep(300);
const md = await page.$eval(".note .md", (e) => e.innerHTML);
check("nota: Markdown renderizado (h1 + lista)", md.includes("<h1") && md.includes("<li>"));

// ---- Esboço (desenha um retângulo e um traço)
await clickBtn("Esboço", ".toolbar button");
await sleep(500);
const svg = await page.$(".sketch svg");
const sb = await svg.boundingBox();
await clickBtn("Retângulo", ".sketch-bar button");
await page.mouse.move(sb.x + 30, sb.y + 30); await page.mouse.down(); await page.mouse.move(sb.x + 150, sb.y + 90, { steps: 8 }); await page.mouse.up();
await clickBtn("Caneta", ".sketch-bar button");
await page.mouse.move(sb.x + 40, sb.y + 120); await page.mouse.down();
for (let i = 0; i < 10; i++) await page.mouse.move(sb.x + 40 + i * 12, sb.y + 120 + (i % 2) * 15);
await page.mouse.up();
await sleep(300);
const shapes = await page.$$eval(".sketch svg > *:not(defs)", (e) => e.map((x) => x.tagName));
check("esboço: retângulo e traço desenhados", shapes.includes("rect") && shapes.includes("polyline"), shapes.join(","));

// ---- Diagrama
await clickBtn("Diagrama", ".toolbar button");
await sleep(500);
const dsel = ".node:last-of-type .sketch-bar";
const dBar = (await page.$$(".sketch-bar")).at(-1);
const clickIn = (bar, text) => bar.evaluate((el, t) => [...el.querySelectorAll("button")].find((b) => b.textContent.includes(t))?.click(), text);
await clickIn(dBar, "Caixa"); await sleep(200);
await clickIn(dBar, "Caixa"); await sleep(200);
const boxes = await page.$$(".dbox");
check("diagrama: duas caixas", boxes.length === 2);
// seleciona a 1a, ativa "Conectar" e clica na 2a
const b0 = await boxes[0].boundingBox();
await page.mouse.click(b0.x + 10, b0.y + 10);
await clickIn(dBar, "Conectar"); await sleep(150);
const b1 = await boxes[1].boundingBox();
await page.mouse.click(b1.x + 10, b1.y + 10);
await sleep(300);
const links = await page.$$eval(`.sketch svg line[marker-end]`, (l) => l.length);
check("diagrama: conector criado", links >= 1);

// ---- Arquivo (README.md) e código
await clickBtn("Arquivo", ".toolbar button");
await sleep(500);
const fileInputs = await page.$$(".file-bar input");
const fin = fileInputs.at(-1);
await fin.click(); await page.keyboard.down("Control"); await page.keyboard.press("a"); await page.keyboard.up("Control");
await fin.type(repo + "/README.md");
await page.keyboard.press("Enter");
await waitFor(() => page.$(".file-body .md"));
check("arquivo: Markdown do README renderizado", (await page.$$eval(".file-body .md", (e) => e.at(-1)?.innerHTML ?? "")).includes("Titulo do Readme"));
await clickBtn("Arquivo", ".toolbar button");
await sleep(500);
const fin2 = (await page.$$(".file-bar input")).at(-1);
await fin2.click(); await page.keyboard.down("Control"); await page.keyboard.press("a"); await page.keyboard.up("Control");
await fin2.type(repo + "/exemplo.ts");
await page.keyboard.press("Enter");
await waitFor(() => page.$(".file-body .code"));
const code = await page.$$eval(".file-body .code", (e) => e.at(-1)?.innerHTML ?? "");
check("arquivo: código com realce", code.includes("tk-k") && code.includes("tk-n") && code.includes("tk-c"));

// ---- Navegador (iframe em localhost)
await clickBtn("Navegador", ".toolbar button");
await sleep(500);
const bin = (await page.$$(".file-bar input")).at(-1);
await bin.click(); await page.keyboard.down("Control"); await page.keyboard.press("a"); await page.keyboard.up("Control");
await bin.type("http://localhost:8123/");
await page.keyboard.press("Enter");
await sleep(1500);
const frame = (await page.$$("iframe")).at(-1);
const cf = await frame.contentFrame();
const frameText = cf ? await cf.evaluate(() => document.body.innerText).catch(() => "") : "";
check("navegador: iframe carrega servidor local", frameText.includes("Servidor local OK"), frameText.trim());
await bin.click(); await page.keyboard.down("Control"); await page.keyboard.press("a"); await page.keyboard.up("Control");
await bin.type("https://exemplo.com/");
await page.keyboard.press("Enter");
await sleep(500);
check("navegador: URL externa é bloqueada", (await page.$$eval(".err", (e) => e.map((x) => x.textContent))).some((t) => t.includes("localhost")));

// ---- Zona
await clickBtn("Zona", ".toolbar button");
await sleep(400);
check("zona criada", (await page.$$(".zone")).length === 1);

await fit();
await shot(page, "40-todos-os-nos");

// ---- Terminal + git info + worktree
await page.select(".toolbar select", "shell");
await sleep(2500);
await fit();
const gitChip = await waitFor(async () => (await page.$$eval(".chip", (c) => c.map((x) => x.textContent).find((t) => t.includes("⎇")))) ?? null, 15000);
check("cabeçalho do terminal mostra a branch git", !!gitChip, gitChip ?? "");
const termHdr = (await page.$$(".node-hdr")).at(-1);
await termHdr.evaluate((el) => [...el.querySelectorAll("button")].find((b) => b.title.includes("worktree"))?.click());
await sleep(500);
await page.keyboard.type("ideia-x");
await page.keyboard.press("Enter");
const wt = await waitFor(() => fs.existsSync(repo + "-wt-ideia-x"), 15000);
check("git worktree criado com um clique", !!wt);
const branches = execSync("git branch --list", { cwd: repo }).toString();
check("branch regente/ideia-x criada", branches.includes("regente/ideia-x"), branches.trim().replace(/\s+/g, " "));
await sleep(2500);
const titles = await nodeTitles();
check("novo terminal aberto no worktree", titles.some((t) => t.includes("ideia-x")), titles.join(","));

// ---- Tema claro + configurações
await clickBtn("⚙", ".toolbar button");
await sleep(400);
await page.select(".modal select", "light");
await sleep(500);
check("tema claro aplicado", (await page.evaluate(() => document.documentElement.dataset.theme)) === "light");
await shot(page, "41-tema-claro");
await page.select(".modal select", "dark");
await page.keyboard.press("Escape");

// ---- Editor de perfis + detecção no PATH
await clickBtn("Perfis de agentes", ".toolbar button");
await sleep(400);
await clickBtn("Detectar no PATH", ".modal button");
await sleep(1500);
const det = (await page.$$eval(".modal .small", (e) => e.map((x) => x.innerText))).at(-1);
check("perfis: detecção no PATH (claude/kiro-cli)", det.includes("claude: encontrado") && det.includes("kiro-cli: encontrado"), det.replace(/\s+/g, " ").slice(0, 120));
await shot(page, "42-perfis");
await page.keyboard.press("Escape");

// ---- Importação de workspace por arquivo
const imp = { version: 1, id: "x", name: "Importado", root: "", nodes: [{ id: "n1", kind: "note", x: 0, y: 0, w: 300, h: 200, z: 1, title: "Nota importada", text: "ok" }], zones: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
fs.writeFileSync(path.join(OUT, "import.json"), JSON.stringify(imp));
await clickBtn("Workspaces", ".tabs button");
await sleep(300);
const fi = await page.$('input[type="file"]');
await fi.uploadFile(path.join(OUT, "import.json"));
await sleep(700);
// a importação pede a pasta raiz nesta máquina (arquivo de terceiros não é confiável)
await page.keyboard.type(ROOT);
await page.keyboard.press("Enter");
await sleep(1500);
check("importar workspace por arquivo", (await nodeTitles()).includes("Nota importada"));

// ---- Paleta e minimapa já testados; erros de console?
console.log(`\n${results.filter(Boolean).length}/${results.length} OK`);
server.close();
browser.disconnect();
process.exit(0);
