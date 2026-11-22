// E2E das rotinas agendadas: criar pela UI, executar agora, pré-execução com {{output}} e lembrete.
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
  await sleep(500);
};
const fillRoutine = async ({ title, text, preRun, reminder }) => {
  const labels = await page.$$(".modal .form label");
  const byText = async (frag) => {
    for (const l of labels) if ((await l.evaluate((e) => e.textContent)).includes(frag)) return l;
    return null;
  };
  await (await byText("Nome")).$eval("input", (i, v) => { i.focus(); }, "");
  await (await (await byText("Nome")).$("input")).type(title);
  await (await (await byText("Mensagem")).$("textarea")).type(text);
  if (preRun) await (await (await byText("Pré-execução")).$("input")).type(preRun);
  if (reminder) await (await (await byText("Apenas lembrar")).$("input")).click();
  await clickBtn("Adicionar", ".modal button.primary");
  await sleep(500);
};

await clickBtn("Workspaces", ".tabs button");
await sleep(300);
await page.type('.form input[placeholder="Nome"]', "E2E Rotinas");
await page.type(".form .inline input", ROOT);
await clickBtn("Criar", "button.primary");
await waitFor(async () => ((await page.$(".canvas")) && (await page.$$(".node")).length === 0 ? true : null));
await sleep(800);
await page.select(".toolbar select", "shell");
await sleep(2500);

await palette("rotinas");
check("paleta abre a tela de rotinas", !!(await page.$(".routine-list")));

// 1) envio simples
await fillRoutine({ title: "Simples", text: "rotina-e2e-simples" });
check("rotina criada aparece na lista", (await page.$$(".routine-row")).length === 1);
await clickBtn("Executar agora", ".routine-row button");
const got = await waitFor(async () => ((await termText(0)).includes("rotina-e2e-simples") ? true : null));
check("`Executar agora` injeta a mensagem no terminal do agente", !!got);
const runs1 = await waitFor(async () => ((await page.$eval(".routine-row .muted", (e) => e.textContent)).includes("1 execuções") ? true : null));
check("contador de execuções sobe para 1", !!runs1);

// 2) pré-execução com {{output}}
await fillRoutine({ title: "Com pre", text: "saida={{output}}", preRun: "Write-Output valor-xyz" });
const rows = await page.$$(".routine-row");
await rows[1].$$eval("button", (b) => b[0].click());
const got2 = await waitFor(async () => ((await termText(0)).includes("saida=valor-xyz") ? true : null), 20000);
check("pré-execução alimenta {{output}} da mensagem", !!got2);

// 3) pré-execução sem saída não dispara
await fillRoutine({ title: "Sem saida", text: "nao-deve-aparecer-e2e", preRun: "exit 1" });
const rows3 = await page.$$(".routine-row");
await rows3[2].$$eval("button", (b) => b[0].click());
await sleep(5000);
check("pré-execução sem saída não acorda o agente", !(await termText(0)).includes("nao-deve-aparecer-e2e"));

// 4) lembrete notifica sem injetar
await fillRoutine({ title: "Lembrete", text: "hora-da-pausa-e2e", reminder: true });
const rows4 = await page.$$(".routine-row");
await rows4[3].$$eval("button", (b) => b[0].click());
const toast = await waitFor(async () => ((await page.$$eval(".toast", (t) => t.map((x) => x.textContent).join("|"))).includes("hora-da-pausa-e2e") ? true : null));
check("lembrete mostra aviso ao usuário", !!toast);
check("lembrete não é injetado no terminal", !(await termText(0)).includes("hora-da-pausa-e2e"));
await shot(page, "21-rotinas");

// 5) excluir
await rows4[3].$$eval("button", (b) => b[1].click());
await sleep(400);
check("excluir remove a rotina", (await page.$$(".routine-row")).length === 3);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações OK`);
browser.disconnect();
process.exit(failed.length ? 1 : 0);
