import { connect, shot, sleep, ROOT } from "./lib.mjs";
const { browser, page } = await connect();
const results = [];
const check = (n, ok, x = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${x ? "  -> " + x : ""}`); };
await sleep(4000);
const names = await page.$$eval(".node .title", (e) => e.map((x) => x.textContent));
check("workspace reaberto automaticamente com os 3 nós", names.length === 3 && names.includes("Claude Code") && names.includes("Kiro") && names.includes("AGY"), names.join(","));
check("conexões restauradas", (await page.$$(".edge")).length === 2);
const rows = await page.$$eval(".xterm-rows", (r) => r.map((x) => x.innerText.replace(/\u00a0/g, " ").trim().slice(0, 70)));
check("terminais relançados no diretório certo", rows.length === 3 && rows.every((r) => r.toLowerCase().includes(ROOT.replace(/\//g, "\\").toLowerCase())), rows.join(" || "));
const vp = await page.$eval(".zoom-badge .zoom-val", (e) => e.textContent);
console.log("zoom restaurado:", vp);
await shot(page, "30-restaurado");
// o log de auditoria em disco existe
const audit = await page.evaluate(async () => {
  try { return (await window.__TAURI_INTERNALS__.invoke("orch_log")).length; } catch (e) { return -1; }
});
console.log("entradas no log em memória:", audit);
console.log(`${results.filter(Boolean).length}/${results.length} OK`);
browser.disconnect();
