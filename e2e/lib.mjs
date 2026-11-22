import puppeteer from "puppeteer-core";
export async function connect() {
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${process.env.E2E_PORT ?? 9222}`, defaultViewport: null });
  const pages = await browser.pages();
  const page = pages.find((p) => p.url().includes("tauri.localhost")) ?? pages[0];
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE.ERROR:", m.text().slice(0, 300)); });
  return { browser, page };
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
import { fileURLToPath } from "node:url";
import path from "node:path";
// Raiz do repositório (barras normais): os roteiros criam workspaces apontando para ela.
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..").replace(/\\/g, "/");
export const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "out");
export const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
