// Cenário real: Claude Code -> Kiro e Claude Code -> AGY, conectados por linhas no canvas, via `regente ask --wait`.
import { connect, shot, sleep, ROOT } from "./lib.mjs";
const { browser, page } = await connect();
const clickBtn = (text, scope = "button") => page.evaluate((t, sc) => [...document.querySelectorAll(sc)].find((b) => b.textContent.includes(t))?.click(), text, scope);
const termText = (i) => page.$$eval(".xterm-rows", (r, i) => (r[i] ? r[i].innerText.replace(/\u00a0/g, " ") : ""), i);
const typeIn = async (i, text, enter = true) => {
  const hosts = await page.$$(".xterm-host");
  await hosts[i].click();
  await page.keyboard.type(text, { delay: 4 });
  if (enter) await page.keyboard.press("Enter");
};
const waitFor = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(500); } return null; };

await clickBtn("Workspaces", ".tabs button");
await sleep(300);
await page.type('.form input[placeholder="Nome"]', "Agentes Reais");
await page.type(".form .inline input", ROOT);
await clickBtn("Criar", "button.primary");
await waitFor(async () => (await page.$(".canvas")) && (await page.$$(".node")).length === 0, 8000);
await sleep(800);
for (let i = 0; i < 3; i++) { await page.select(".toolbar select", "shell"); await sleep(1200); }
for (const [i, name] of [[0, "Claude Code"], [1, "Kiro"], [2, "AGY"]]) {
  await page.evaluate((i) => document.querySelectorAll(".node-hdr")[i].dispatchEvent(new MouseEvent("dblclick", { bubbles: true })), i);
  await sleep(400); await page.keyboard.type(name); await page.keyboard.press("Enter"); await sleep(300);
}
await page.keyboard.down("Control"); await page.keyboard.press("1"); await page.keyboard.up("Control");
await sleep(900);

// conecta Claude Code -> Kiro e Claude Code -> AGY
const nodes = await page.$$(".node");
const handleOf = async (n) => (await (await n.$(".connect")).boundingBox());
const hdrOf = async (n) => (await (await n.$(".node-hdr")).boundingBox());
for (const target of [1, 2]) {
  const hb = await handleOf(nodes[0]);
  const tb = await hdrOf(nodes[target]);
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(tb.x + 100, tb.y + 10, { steps: 15 });
  await page.mouse.up();
  await sleep(500);
}
console.log("conexões:", (await page.$$(".edge")).length);
await shot(page, "20-agentes-conectados");

// inicia os agentes reais SEM flags de bypass de permissão (supervisão humana por comando)
await typeIn(1, "kiro-cli chat");
await typeIn(2, "agy");
await sleep(15000);
await shot(page, "21-agentes-iniciados");
const flat = (t) => t.split(String.fromCharCode(10)).filter(Boolean).join(" | ");
console.log("KIRO>>", flat((await termText(1)).slice(-600)));
console.log("AGY>>", flat((await termText(2)).slice(-600)));
browser.disconnect();
