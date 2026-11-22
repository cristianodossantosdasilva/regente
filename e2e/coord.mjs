// E2E do coordenador: marcar terminal como coordenador, recrutar, listar, conectar e dispensar por CLI.
import { connect, shot, sleep, ROOT } from "./lib.mjs";

const { browser, page } = await connect();
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  -> " + extra : ""}`);
};
const clickBtn = (text, scope = "button") =>
  page.evaluate((t, sc) => [...document.querySelectorAll(sc)].find((b) => b.textContent.includes(t))?.click(), text, scope);
const termText = (i) => page.$$eval(".xterm-rows", (r, i) => (r[i] ? r[i].innerText.replace(/\u00a0/g, " ").replace(/\r?\n/g, "") : ""), i);
const typeIn = async (i, text) => {
  const hosts = await page.$$(".xterm-host");
  await hosts[i].click();
  await sleep(250);
  await hosts[i].evaluate((h) => h.querySelector("textarea")?.focus());
  await page.keyboard.type(text, { delay: 8 });
  await page.keyboard.press("Enter");
};
const waitFor = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(250);
  }
  return null;
};
const fitAll = async () => {
  await page.keyboard.down("Control");
  await page.keyboard.press("1");
  await page.keyboard.up("Control");
  await sleep(1200);
};
// índice do xterm que pertence ao nó com este título
const idxOf = (title) =>
  page.evaluate((t) => {
    const hosts = [...document.querySelectorAll(".xterm-host")];
    return hosts.findIndex((h) => h.closest(".node")?.querySelector(".title")?.textContent === t);
  }, title);
const typeInTitle = async (title, text) => {
  await fitAll();
  const i = await idxOf(title);
  if (i < 0) throw new Error("terminal não visível: " + title);
  await typeIn(i, text);
  return i;
};
const textOf = async (title) => termText(await idxOf(title));
const titles = () => page.$$eval(".node .title", (e) => e.map((x) => x.textContent));
const palette = async (query) => {
  await page.keyboard.down("Control");
  await page.keyboard.press("k");
  await page.keyboard.up("Control");
  await sleep(400);
  await page.keyboard.type(query);
  await sleep(250);
  await page.keyboard.press("Enter");
  await sleep(500);
};

await clickBtn("Workspaces", ".tabs button");
await sleep(300);
await page.type('.form input[placeholder="Nome"]', "E2E Coordenador");
await page.type(".form .inline input", ROOT);
await clickBtn("Criar", "button.primary");
await waitFor(async () => ((await page.$(".canvas")) && (await page.$$(".node")).length === 0 ? true : null));
await sleep(800);
await page.select(".toolbar select", "shell");
await sleep(2000);
await page.evaluate(() => document.querySelector(".node-hdr").dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
await sleep(400);
await page.keyboard.type("Maestro");
await page.keyboard.press("Enter");
await sleep(400);

// 1) sem ser coordenador: negado
await typeIn(0, "regente recruit shell --name Worker");
const denied = await waitFor(async () => ((await termText(0)).includes("apenas terminais marcados como coordenador") ? true : null));
check("sem ser coordenador, `regente recruit` é negado", !!denied);

// 2) marca como coordenador pela paleta
await palette("coordenador");
const badge = await waitFor(async () => ((await page.$$eval(".node-hdr .chip", (c) => c.some((x) => x.textContent.includes("👑")))) ? true : null));
check("paleta marca o terminal como coordenador (chip 👑)", !!badge);
await sleep(1200);

// 3) recruit cria terminal conectado
await typeIn(0, "regente recruit shell --name Worker");
const created = await waitFor(async () => ((await titles()).includes("Worker") ? true : null), 20000);
check("`regente recruit` cria o terminal 'Worker' no canvas", !!created, (await titles()).join(","));
await sleep(1500);
check("recrutado já nasce conectado ao coordenador", (await page.$$(".edge")).length === 1);
const out = await termText(0);
check("CLI confirma o recrutamento", out.includes("recrutado: Worker"));

// 4) peers enxerga o recrutado e o recrutado enxerga o coordenador
await typeInTitle("Maestro", "regente peers");
const seen = await waitFor(async () => ((await textOf("Maestro")).includes("<-> Worker") ? true : null));
check("`regente peers` do coordenador lista o Worker", !!seen, seen ? "" : (await textOf("Maestro")).slice(-260));
await sleep(1500);
await typeInTitle("Worker", "regente peers");
const back = await waitFor(async () => ((await textOf("Worker")).includes("<-> Maestro") ? true : null));
check("o recrutado enxerga o coordenador", !!back);

// 5) limite de coordenação: recrutado não é coordenador
await typeInTitle("Worker", "regente recruit shell");
const noRec = await waitFor(async () => ((await textOf("Worker")).includes("apenas terminais marcados como coordenador") ? true : null));
check("recrutado não pode recrutar (sem recursão)", !!noRec);
await shot(page, "20-coordenador");

// 6) dismiss remove o terminal
await typeInTitle("Maestro", "regente dismiss Worker");
const gone = await waitFor(async () => (!(await titles()).includes("Worker") ? true : null));
check("`regente dismiss` remove o terminal recrutado", !!gone, (await titles()).join(","));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações OK`);
browser.disconnect();
process.exit(failed.length ? 1 : 0);
