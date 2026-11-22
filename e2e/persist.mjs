// Confere que o workspace aberto antes de reiniciar o app volta com N nós. Uso: node persist.mjs <N>
import { connect, sleep } from "./lib.mjs";

const expected = Number(process.argv[2] ?? 6);
const { browser, page } = await connect();
await sleep(1500);
const titles = await page.$$eval(".node .title", (e) => e.map((x) => x.textContent));
const ok = titles.length === expected;
console.log(`${ok ? "PASS" : "FAIL"}  workspace restaurado após reiniciar: ${titles.length} nós (esperado ${expected}) -> ${titles.join(",")}`);
browser.disconnect();
process.exit(ok ? 0 : 1);
