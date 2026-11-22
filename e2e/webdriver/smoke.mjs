// E2E de fumaça no Linux/macOS (WebDriver via tauri-driver): workspace, terminal real, CLI `regente` dentro do terminal,
// coordenador, recrutamento e troca de mensagens entre dois terminais pelo socket Unix.
// Uso: node smoke.mjs <caminho do regente-app>   (veja e2e/run-linux.sh, que sobe o Xvfb e o tauri-driver)
import { ENTER, ROOT, Session, reporter, sleep, waitFor } from "./lib.mjs";

const app = process.argv[2];
if (!app) throw new Error("uso: node smoke.mjs <caminho do regente-app>");
const { check, done } = reporter();
const s = await Session.start(app);
let code = 1;
try {
  await s.setWindow(1700, 1000);
  await waitFor(() => s.has(".app"));
  check("o app abre e renderiza a interface", await s.has(".toolbar"));

  // 1) workspace novo pela interface
  await s.clickText("Workspaces", ".tabs button");
  await sleep(300);
  await s.keys(await s.find('.form input[placeholder="Nome"]'), "E2E Linux");
  await s.keys(await s.find(".form .inline input"), ROOT);
  await s.clickText("Criar", "button.primary");
  check("workspace criado e aberto", !!(await waitFor(() => s.has(".canvas"))));
  await sleep(800);

  // 2) terminal real (shell padrão do usuário) com o CLI no PATH
  await s.selectValue(".toolbar select", "shell");
  await waitFor(async () => (await s.nodeTitles()).length === 1);
  const first = (await s.nodeTitles())[0];
  const prompt = await waitFor(async () => ((await s.termText(first)).trim().length > 3 ? true : null), 20000);
  check("terminal abre um shell real (há prompt)", !!prompt, await s.termText(first));
  await s.typeIn(first, "pwd");
  check("o terminal começa na pasta do workspace", !!(await waitFor(async () => ((await s.termText(first)).includes(ROOT) ? true : null))));

  // 3) CLI dentro do terminal, falando com o broker pelo socket Unix com o token do terminal
  await s.typeIn(first, "regente debug");
  const dbg = await waitFor(async () => ((await s.termText(first)).includes("broker: ok") ? true : null));
  check("`regente debug` fala com o broker (socket Unix + token por terminal)", !!dbg, dbg ? "" : await s.termText(first));
  await s.typeIn(first, 'regente status "teste linux" --state working --progress 1/2');
  const chip = await waitFor(async () => ((await s.exec("return [...document.querySelectorAll('.node-hdr .chip')].map((c)=>c.textContent.trim()).join('|');")).includes("1/2") ? true : null));
  check("`regente status` aparece como chip no cabeçalho", !!chip);

  // 4) coordenador pela paleta + recrutar
  await s.shortcut("k", { ctrlKey: true });
  await sleep(500);
  await s.keys(await s.find(".modal .big"), "coordenador" + ENTER);
  const crown = await waitFor(async () => ((await s.exec("return [...document.querySelectorAll('.node-hdr .chip')].some((c)=>c.textContent.includes('\\u{1F451}'));")) ? true : null));
  check("paleta marca o terminal como coordenador", !!crown);
  await sleep(1200);
  await s.typeIn(first, "regente recruit shell --name Worker");
  const worker = await waitFor(async () => ((await s.nodeTitles()).includes("Worker") ? true : null), 25000);
  check("`regente recruit` cria o terminal Worker", !!worker, (await s.nodeTitles()).join(","));
  await sleep(1500);
  await s.shortcut("1", { ctrlKey: true }); // ajustar tudo na tela (evita dormência por estar fora da vista)
  await sleep(1500);

  // 5) mensagens entre dois terminais
  await s.typeIn(first, "regente peers");
  check("`regente peers` lista o Worker conectado", !!(await waitFor(async () => ((await s.termText(first)).includes("<-> Worker") ? true : null))));
  await s.typeIn(first, 'regente send Worker "ola-do-linux"');
  const got = await waitFor(async () => ((await s.termText("Worker")).includes("ola-do-linux") ? true : null));
  check("mensagem do coordenador chega ao Worker pelo broker", !!got);

  await s.typeIn(first, 'regente ask Worker "tudo certo?" --wait');
  const id = await waitFor(async () => {
    const m = (await s.termText("Worker")).match(/id ([0-9a-f]{8})/g);
    return m ? m[m.length - 1].replace("id ", "") : null;
  });
  check("pergunta chega ao Worker com um id", !!id, id ?? "");
  if (id) {
    await s.typeIn("Worker", `regente reply ${id} "sim-linux-ok"`);
    const back = await waitFor(async () => ((await s.termText(first)).includes("sim-linux-ok") ? true : null));
    check("a resposta volta para o `ask --wait` do coordenador", !!back);
    if (!back) {
      console.log("DIAG Worker :", (await s.termText("Worker")).slice(-500));
      console.log("DIAG Shell  :", (await s.termText(first)).slice(-500));
    }
  }

  // 6) dispensar
  await s.typeIn(first, "regente dismiss Worker");
  const gone = await waitFor(async () => (!(await s.nodeTitles()).includes("Worker") ? true : null));
  check("`regente dismiss` remove o Worker", !!gone, (await s.nodeTitles()).join(","));
  code = done();
} catch (e) {
  console.log("ERRO:", e.message);
  check("execução sem exceções", false, e.message);
  code = done();
} finally {
  await s.close();
}
process.exit(code);
