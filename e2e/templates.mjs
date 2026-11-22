// E2E dos templates de equipe: salvar o desenho atual e inserir de novo (ids/títulos únicos, conexões, persistência).
import { connect, shot, sleep, ROOT } from "./lib.mjs";

const { browser, page } = await connect();
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  -> " + extra : ""}`);
};
const clickBtn = (text, scope = "button") =>
  page.evaluate((t, sc) => [...document.querySelectorAll(sc)].find((b) => b.textContent.includes(t))?.click(), text, scope);
const waitFor = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(250);
  }
  return null;
};
const palette = async (query) => {
  await page.keyboard.down("Control");
  await page.keyboard.press("k");
  await page.keyboard.up("Control");
  await sleep(400);
  await page.keyboard.type(query);
  await sleep(250);
  await page.keyboard.press("Enter");
  await sleep(600);
};
const titles = () => page.$$eval(".node .title", (e) => e.map((x) => x.textContent));

await clickBtn("Workspaces", ".tabs button");
await sleep(300);
await page.type('.form input[placeholder="Nome"]', "E2E Templates");
await page.type(".form .inline input", ROOT);
await clickBtn("Criar", "button.primary");
await waitFor(async () => ((await page.$(".canvas")) && (await page.$$(".node")).length === 0 ? true : null));
await sleep(800);
await page.select(".toolbar select", "shell");
await sleep(1500);
await page.select(".toolbar select", "shell");
await sleep(1500);
await palette("nova nota");

// conecta o 1º terminal ao 2º por arraste (porta da borda)
const handles = await page.$$(".node .port, .node .handle, .node [data-port]");
check("há nós suficientes (2 terminais + nota)", (await titles()).length === 3, (await titles()).join(","));
await shot(page, "22-antes-template");

// salva template
await palette("equipes");
check("paleta abre a tela de equipes", !!(await page.$(".routine-list")));
await page.type(".modal .form input", "Time E2E");
await clickBtn("Salvar como template", ".modal button.primary");
await sleep(600);
const listed = await waitFor(async () => ((await page.$$eval(".modal .routine-row b", (b) => b.map((x) => x.textContent))).includes("Time E2E") ? true : null));
check("template salvo aparece na lista", !!listed);
const counts = await page.$eval(".modal .routine-row .muted", (e) => e.textContent);
check("contagem do template: 2 agentes e 1 nota", counts.includes("2 agente") && counts.includes("1 nota"), counts);

// insere
await clickBtn("Inserir", ".modal .routine-row button");
await sleep(2500);
const after = await titles();
check("inserir cria 3 nós novos (total 6)", after.length === 6, after.join(","));
check("títulos ficam únicos (sem duplicatas)", new Set(after.map((t) => t.toLowerCase())).size === after.length, after.join(","));
const rects = await page.$$eval(".node", (n) => n.map((e) => e.getBoundingClientRect().toJSON()));
let overlap = false;
for (let i = 0; i < rects.length; i++)
  for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    if (a.left < b.right - 2 && a.right > b.left + 2 && a.top < b.bottom - 2 && a.bottom > b.top + 2) overlap = true;
  }
check("equipe inserida não sobrepõe nós existentes", !overlap);
await shot(page, "23-depois-template");

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações OK`);
browser.disconnect();
process.exit(failed.length ? 1 : 0);
