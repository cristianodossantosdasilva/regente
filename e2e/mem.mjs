import { connect, shot, sleep } from "./lib.mjs";
const { browser, page } = await connect();
const waitFor = async (fn, ms = 12000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(250); } return null; };
await page.select(".toolbar select", "shell");
await sleep(2500);
// abre configurações e baixa o alerta para 10 MB
await page.evaluate(() => [...document.querySelectorAll(".toolbar button")].find((b) => b.textContent.includes("⚙"))?.click());
await sleep(400);
const inputs = await page.$$(".modal input[type=number]");
const memInput = inputs[2]; // fonte, scrollback, alerta RAM
await memInput.click();
await page.keyboard.down("Control"); await page.keyboard.press("a"); await page.keyboard.up("Control");
await page.keyboard.type("10");
await sleep(300);
await page.keyboard.press("Escape");
const toast = await waitFor(() => page.$eval(".toast", (e) => e.textContent).catch(() => null));
const warnChip = await waitFor(() => page.$eval(".node-hdr .chip.warn.mono", (e) => e.textContent).catch(() => null));
console.log(toast ? "PASS  toast de alerta: " + toast : "FAIL  sem toast");
console.log(warnChip ? "PASS  chip de RAM destacado: " + warnChip : "FAIL  sem chip de alerta");
// restaura o limite
await page.evaluate(() => [...document.querySelectorAll(".toolbar button")].find((b) => b.textContent.includes("⚙"))?.click());
await sleep(400);
const i2 = (await page.$$(".modal input[type=number]"))[2];
await i2.click(); await page.keyboard.down("Control"); await page.keyboard.press("a"); await page.keyboard.up("Control"); await page.keyboard.type("1500");
await page.keyboard.press("Escape");
browser.disconnect();
