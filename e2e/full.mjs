import { connect, shot, sleep, ROOT } from "./lib.mjs";

const { browser, page } = await connect();
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  -> " + extra : ""}`);
};
const clickBtn = (text, scope = "button") =>
  page.evaluate((t, sc) => [...document.querySelectorAll(sc)].find((b) => b.textContent.includes(t))?.click(), text, scope);
// junta as linhas visuais: quebras por largura do terminal n\u00e3o s\u00e3o quebras reais
const termText = (i) => page.$$eval(".xterm-rows", (r, i) => (r[i] ? r[i].innerText.replace(/\u00a0/g, " ").replace(/\r?\n/g, "") : ""), i);
const typeIn = async (i, text) => {
  const hosts = await page.$$(".xterm-host");
  await hosts[i].click();
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

// 1) workspace novo pela UI (barras normais para evitar escapes)
await clickBtn("Workspaces", ".tabs button");
await sleep(300);
await page.type('.form input[placeholder="Nome"]', "E2E Regente");
await page.type(".form .inline input", ROOT);
await clickBtn("Criar", "button.primary");
check("workspace criado e aberto (canvas vazio)", !!(await waitFor(async () => (await page.$(".canvas")) && (await page.$$(".node")).length === 0 ? true : null)));
await sleep(800);

// 2) dois terminais; renomeia via duplo clique + modal
await page.select(".toolbar select", "shell");
await sleep(1500);
await page.select(".toolbar select", "shell");
await sleep(1500);
const titles = await page.$$(".node .title");
for (const [i, name] of [[0, "Claude"], [1, "Kiro"]]) {
  await page.evaluate((i) => document.querySelectorAll(".node-hdr")[i].dispatchEvent(new MouseEvent("dblclick", { bubbles: true })), i);
  await sleep(400);
  await page.keyboard.type(name);
  await page.keyboard.press("Enter");
  await sleep(300);
}
const names = await page.$$eval(".node .title", (e) => e.map((x) => x.textContent));
check("renomear por modal", names.includes("Claude") && names.includes("Kiro"), names.join(","));

// nós não se sobrepõem
const rects = await page.$$eval(".node", (n) => n.map((e) => e.getBoundingClientRect().toJSON()));
const ov = rects[0].left < rects[1].right && rects[0].right > rects[1].left && rects[0].top < rects[1].bottom && rects[0].bottom > rects[1].top;
check("nós novos não se sobrepõem", !ov);
await shot(page, "10-dois-terminais");

// 3) PTY real + cwd correto
await waitFor(async () => (await termText(0)).includes("PS "));
const t0 = await termText(0);
check("terminal mostra prompt do PowerShell", t0.includes("PS "), t0.trim().slice(0, 60));
check("cwd do terminal = raiz do workspace", /Regente>/.test(t0), t0.trim().slice(0, 60));

// 4) enquadra tudo (Ctrl+1) e conecta por arraste: ponto de A -> B
await page.keyboard.down("Control"); await page.keyboard.press("1"); await page.keyboard.up("Control");
await sleep(900);
await shot(page, "10b-fit");
const handle = (await page.$$(".node .connect"))[0];
const hb = await handle.boundingBox();
const nodeB = (await page.$$(".node"))[1];
const bb = await (await nodeB.$(".node-hdr")).boundingBox();
await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
await page.mouse.down();
await page.mouse.move(bb.x + 120, bb.y + 12, { steps: 12 });
await page.mouse.up();
await sleep(600);
check("conexão criada por arraste", (await page.$$(".edge")).length === 1);
await shot(page, "11-conectado");

// 5) regente peers dentro do terminal A
await sleep(2500);
await typeIn(0, "regente peers");
const peers = await waitFor(async () => ((await termText(0)).includes("Kiro [") ? await termText(0) : null));
check("`regente peers` no terminal A lista o Kiro", !!peers, peers ? peers.split("\n").filter((l) => l.includes("Kiro")).join("|") : "sem saída");

// 6) send A -> B
await typeIn(0, 'regente send Kiro "revise o modulo geometry"');
const got = await waitFor(async () => ((await termText(1)).includes("revise o modulo geometry") ? true : null));
check("mensagem de A chega no terminal B via broker", !!got);

// 6b) status de trabalho, debug e peers com identidade/estado
await typeIn(1, 'regente status "revisando geometry" --state working --progress 2/5');
const chip = await waitFor(async () => page.$$eval(".node-hdr .chip", (cs) => cs.map((c) => c.textContent.trim()).find((t) => t.includes("2/5")) ?? null));
check("`regente status` mostra o chip de trabalho no cabeçalho do terminal", !!chip, chip ?? "");
await typeIn(0, "regente peers");
const peers2 = await waitFor(async () => {
  const t = await termText(0);
  return t.includes("revisando geometry") && t.includes("você: Claude") ? t : null;
});
check("`regente peers` mostra a identidade própria e o status do par", !!peers2);
await typeIn(0, "regente debug");
const dbg = await waitFor(async () => ((await termText(0)).includes("broker: ok") ? true : null));
check("`regente debug` confirma a ida e volta ao broker", !!dbg);

// 7) ask --wait de A, reply de B
await typeIn(0, 'regente ask Kiro "tudo certo?" --wait');
const idText = await waitFor(async () => {
  const m = (await termText(1)).match(/pergunta \(id ([0-9a-f]{8})\)/);
  return m ? m[1] : null;
});
check("pergunta com id aparece em B", !!idText, idText ?? "");
if (idText) {
  await sleep(500);
  await typeIn(1, `regente reply ${idText} "sim, aprovado"`);
  const ans = await waitFor(async () => ((await termText(0)).includes("sim, aprovado") ? true : null));
  check("resposta de B volta para o `--wait` de A", !!ans);
}

// 8) painel de atividade
await clickBtn("Atividade", ".tabs button");
await sleep(500);
const log = await page.$$eval(".log", (l) => l.map((x) => x.innerText.replace(/\s+/g, " ")));
check("painel de atividade registra send/ask/reply", log.length >= 3 && log.some((l) => l.includes("reply")), `${log.length} entradas`);
await shot(page, "12-atividade");

// 9) pausa global bloqueia
await clickBtn("Pausar orquestração", "button.pause");
await sleep(300);
await typeIn(0, 'regente send Kiro "durante pausa"');
const paused = await waitFor(async () => ((await termText(0)).includes("pausada") ? true : null));
check("pausa global bloqueia envio", !!paused);
await clickBtn("Retomar orquestração", "button.pause");

// 10) confirmação humana por conexão
await page.click(".edge .hit", { offset: { x: 0, y: 0 } }).catch(() => {});
await page.evaluate(() => {
  const l = document.querySelector(".edge .hit");
  const r = l.getBoundingClientRect();
  l.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
});
await sleep(400);
const popLabels = await page.$$eval(".edge-pop label", (l) => l.map((x) => x.textContent.trim()));
check("popover da conexão abre", popLabels.length === 3 && popLabels.some((l) => l.includes("teclas")), popLabels.join("|"));
await page.evaluate(() => [...document.querySelectorAll(".edge-pop label")].find((l) => l.textContent.includes("confirmação"))?.querySelector("input").click());
await sleep(400);
await typeIn(0, 'regente send Kiro "precisa de ok"');
const modal = await waitFor(() => page.$(".modal pre.quote"));
check("modal de confirmação humana aparece", !!modal);
if (modal) {
  await page.evaluate(() => [...document.querySelectorAll(".modal button")].find((b) => b.textContent.includes("Permitir"))?.click());
  const ok = await waitFor(async () => ((await termText(1)).includes("precisa de ok") ? true : null));
  check("após permitir, mensagem é entregue", !!ok);
}
await shot(page, "13-confirmacao");

// 11) zoom/pan/fit
const z0 = await page.$eval(".zoom-badge", (e) => e.textContent);
await page.keyboard.down("Control");
await page.mouse.move(800, 400);
await page.mouse.wheel({ deltaY: -400 });
await page.keyboard.up("Control");
await sleep(400);
const z1 = await page.$eval(".zoom-badge", (e) => e.textContent);
check("Ctrl+scroll altera o zoom", z0 !== z1, `${z0} -> ${z1}`);
await page.keyboard.down("Control");
await page.keyboard.press("1");
await page.keyboard.up("Control");
await sleep(500);
await shot(page, "14-fit");

// 12) dormência: afasta a viewport; xterm deve ser destruído e depois reconstruído com histórico
const before = await page.$$eval(".xterm", (x) => x.length);
await page.evaluate(() => document.querySelector(".canvas").dispatchEvent(new WheelEvent("wheel", { deltaX: 0, deltaY: 6000, bubbles: true, cancelable: true })));
await sleep(800);
const away = await page.$$eval(".xterm", (x) => x.length);
check("terminais fora da tela ficam dormentes (xterm destruído)", before >= 2 && away === 0, `${before} -> ${away}`);
await page.evaluate(() => document.querySelector(".canvas").dispatchEvent(new WheelEvent("wheel", { deltaX: 0, deltaY: -6000, bubbles: true, cancelable: true })));
await sleep(1200);
const back = await page.$$eval(".xterm", (x) => x.length);
const restored = await termText(0);
check("ao voltar, xterm é recriado com o histórico (replay)", back >= 2 && restored.includes("sim, aprovado"), `${back} xterms`);

// 13) paleta e busca
await page.keyboard.down("Control");
await page.keyboard.press("k");
await page.keyboard.up("Control");
await sleep(400);
check("paleta Ctrl+K abre", !!(await page.$(".modal .big")));
await page.keyboard.type("nova nota");
await sleep(200);
await page.keyboard.press("Enter");
await sleep(500);
check("paleta executa comando (nova nota)", (await page.$$eval(".node .title", (e) => e.map((x) => x.textContent))).includes("Nota"));
await page.keyboard.down("Control");
await page.keyboard.down("Shift");
await page.keyboard.press("F");
await page.keyboard.up("Shift");
await page.keyboard.up("Control");
await sleep(300);
await page.keyboard.type("aprovado");
await sleep(900);
const sr = await page.$$eval(".results .result", (r) => r.map((x) => x.innerText.replace(/\s+/g, " ")));
check("busca global encontra saída de terminal", sr.some((s) => s.includes("aprovado")), sr.slice(0, 2).join(" | "));
await page.keyboard.press("Escape");

await shot(page, "15-final");
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações OK`);
browser.disconnect();
