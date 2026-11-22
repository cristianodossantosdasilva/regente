// uso: node key.mjs <indice-do-terminal> <texto|@Enter|@Esc|@Tab|@Down> ...   (digita no terminal indicado do app)
import { connect, sleep } from "./lib.mjs";
const [, , idx, ...parts] = process.argv;
const { browser, page } = await connect();
const hosts = await page.$$(".xterm-host");
await hosts[Number(idx)].click();
for (const p of parts) {
  if (p.startsWith("@")) await page.keyboard.press(p.slice(1));
  else await page.keyboard.type(p, { delay: 4 });
  await sleep(150);
}
await sleep(Number(process.env.WAIT ?? 2500));
const text = await page.$$eval(".xterm-rows", (r, i) => (r[i] ? r[i].innerText.replace(/ /g, " ") : ""), Number(idx));
console.log(text.split(String.fromCharCode(10)).filter((l) => l.trim()).slice(-Number(process.env.LINES ?? 25)).join(String.fromCharCode(10)));
browser.disconnect();
