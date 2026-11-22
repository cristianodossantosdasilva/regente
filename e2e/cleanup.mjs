// Remove TODOS os workspaces salvos (use só em máquina de teste/depois dos E2E).
import { connect } from "./lib.mjs";
const { browser, page } = await connect();
const n = await page.evaluate(async () => {
  const inv = window.__TAURI_INTERNALS__.invoke;
  const list = await inv("ws_list");
  for (const w of list) await inv("ws_delete", { id: w.id });
  localStorage.removeItem("regente.last");
  return list.length;
});
console.log(`${n} workspaces de teste removidos`);
browser.disconnect();
