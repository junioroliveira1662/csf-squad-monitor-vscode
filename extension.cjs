const vscode = require("vscode");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const crypto = require("node:crypto");
const { types } = require("./hook.cjs");

function hooks(collector, connection) {
  const entries = types.map((type) => [
    type,
    [
      {
        type: "command",
        bash: 'node "$MAPA_COLETOR" ' + type,
        powershell: 'node "$env:MAPA_COLETOR" ' + type,
        env: {
          MAPA_COLETOR: collector,
          MAPA_CONEXAO: connection,
        },
        timeoutSec: 3,
      },
    ],
  ]);
  return (
    JSON.stringify(
      { version: 1, hooks: Object.fromEntries(entries) },
      null,
      2,
    ) + "\n"
  );
}
function configPath() {
  const folders = vscode.workspace.workspaceFolders;
  if (folders?.length === 1 && folders[0].uri.scheme === "file") {
    return path.join(
      folders[0].uri.fsPath,
      ".github",
      "hooks",
      "mapa-de-agentes.json",
    );
  }
}

async function enable(panel, context, cleanup, log) {
  const folders = vscode.workspace.workspaceFolders;
  if (
    !vscode.workspace.isTrusted ||
    folders?.length !== 1 ||
    folders[0].uri.scheme !== "file"
  ) {
    throw new Error(
      "Abra uma pasta local confiável para conectar os hooks do Copilot.",
    );
  }
  // A mesma pasta pode ser aberta diretamente ou dentro de um arquivo .code-workspace.
  const folderKey = crypto
    .createHash("sha256")
    .update(folders[0].uri.toString())
    .digest("hex");
  const storage = path.join(context.globalStorageUri.fsPath, folderKey);
  const connection = path.join(storage, "painel.json");
  const config = configPath();
  const collector = path.join(storage, "hook.cjs");
  const content = hooks(collector, connection);
  let previous;
  try {
    previous = await fs.readFile(config, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  const oldCollector = path.join(
    path.dirname(context.extensionPath),
    "agent-catalog-local.mapa-de-agentes-0.1.0",
    "hook.cjs",
  );
  const oldConnection = path.join(context.storageUri.fsPath, "painel.json");
  const migrate =
    previous === hooks(oldCollector, oldConnection) ||
    previous ===
      hooks(path.join(context.storageUri.fsPath, "hook.cjs"), oldConnection);
  if (previous !== undefined && previous !== content && !migrate)
    throw new Error(
      "Já existe outra configuração em .github/hooks/mapa-de-agentes.json. Confira esse arquivo antes de conectar.",
    );
  if (previous === undefined) {
    const ok = await vscode.window.showInformationMessage(
      "Criar .github/hooks/mapa-de-agentes.json nesta pasta para acompanhar o Copilot local?",
      "Criar hooks",
    );
    if (!ok) return;
  }
  await fs.mkdir(storage, { recursive: true });
  const collectorTemp = collector + "." + crypto.randomUUID();
  await fs.copyFile(context.asAbsolutePath("hook.cjs"), collectorTemp);
  await fs.rename(collectorTemp, collector);
  if (previous === undefined || migrate) {
    await fs.mkdir(path.dirname(config), { recursive: true });
    if (migrate) {
      const temp = config + "." + crypto.randomUUID();
      await fs.writeFile(temp, content, { flag: "wx" });
      await fs.rename(temp, config);
    } else {
      await fs.writeFile(config, content, { flag: "wx" });
    }
  }
  const key = crypto.randomBytes(32).toString("hex");
  const server = http.createServer(async (req, res) => {
    if (
      req.method !== "POST" ||
      req.url !== "/event" ||
      req.headers.authorization !== "Bearer " + key
    ) {
      res.writeHead(403).end();
      return;
    }
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 8192) {
          res.writeHead(413).end();
          return;
        }
      }
      const e = JSON.parse(body);
      if (
        !types.includes(e.type) ||
        !e.session ||
        !["session", "agent", "parent", "name", "tool", "detail"].every(
          (k) => typeof e[k] === "string" && e[k].length <= 180,
        )
      ) {
        res.writeHead(400).end();
        return;
      }
      const delivered = await panel.webview.postMessage({
        type: "events",
        events: [e],
      });
      log.info(
        e.type +
          " · " +
          (delivered ? "entregue ao painel" : "painel indisponível"),
      );
      res.writeHead(204).end();
    } catch {
      if (!res.headersSent) res.writeHead(400).end();
    }
  });
  // Um socket exclusivo evita entregar eventos a outra aplicação depois que o painel fecha.
  const win = process.platform === "win32";
  const dir = win
    ? null
    : await fs.mkdtemp(
        path.join(
          process.platform === "darwin" ? "/tmp" : os.tmpdir(),
          "mapa-",
        ),
      );
  const socketPath = win
    ? "\\\\.\\pipe\\mapa-" + key
    : path.join(dir, "painel.sock");
  cleanup.push(() =>
    server.close(() => {
      if (dir) fs.rmdir(dir).catch(() => {});
    }),
  );
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });

  const tmp = path.join(storage, "painel-" + key + ".tmp");
  await fs.writeFile(tmp, JSON.stringify({ socketPath, key }), { mode: 0o600 });
  await fs.rename(tmp, connection);
  log.info("Monitor conectado");
  await panel.webview.postMessage({
    type: "listening",
    folder: folders[0].name,
  });
  vscode.window.showInformationMessage(
    "Painel conectado. Inicie uma sessão local do Copilot com os hooks habilitados.",
  );
}
async function renderView(view, context, media) {
  const uri = (file) =>
    view.webview.asWebviewUri(vscode.Uri.joinPath(media, file)).toString();
  const nonce = crypto.randomBytes(16).toString("hex");
  const policy =
    "default-src 'none'; style-src " +
    view.webview.cspSource +
    " 'unsafe-inline'; script-src 'nonce-" +
    nonce +
    "'";
  const html = await fs.readFile(
    vscode.Uri.joinPath(media, "index.html").fsPath,
    "utf8",
  );
  view.webview.html = html
    .replace(
      "<head>",
      '<head><meta http-equiv="Content-Security-Policy" content="' +
        policy +
        '">',
    )
    .replace('href="style.css"', 'href="' + uri("style.css") + '"')
    .replace(
      'src="map.js"',
      'nonce="' + nonce + '" src="' + uri("map.js") + '"',
    );
}
async function activate(context) {
  let panel;
  const log = vscode.window.createOutputChannel("Mapa de agentes", {
    log: true,
  });
  context.subscriptions.push(log);
  async function openMap(startLive = false) {
    if (panel) {
      panel.reveal();
      return;
    }
    const media = vscode.Uri.joinPath(context.extensionUri, "media");
    const view = vscode.window.createWebviewPanel(
      "mapaAgentes",
      "Mapa de agentes",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [media],
      },
    );
    panel = view;
    let busy = false;
    const cleanup = [];
    function disconnect() {
      while (cleanup.length) cleanup.pop()();
    }
    view.onDidDispose(() => {
      panel = undefined;
      disconnect();
    });
    view.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === "demo") {
        disconnect();
        return;
      }
      const autoConnect = msg.type === "ready" && startLive === true;
      if ((!autoConnect && msg.type !== "live") || busy || cleanup.length)
        return;
      busy = true;
      try {
        await enable(view, context, cleanup, log);
      } catch (err) {
        disconnect();
        vscode.window.showErrorMessage("Mapa de agentes · " + err.message);
      } finally {
        busy = false;
        if (panel !== view) disconnect();
      }
    });
    await renderView(view, context, media);
  }
  context.subscriptions.push(
    vscode.commands.registerCommand("mapa.agentes", openMap),
  );
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider("mapa.gravacao", {
      openCustomDocument(uri) {
        return { uri, dispose() {} };
      },
      async resolveCustomEditor(document, view) {
        const media = vscode.Uri.joinPath(context.extensionUri, "media");
        view.webview.options = {
          enableScripts: true,
          localResourceRoots: [media],
        };
        const text = Buffer.from(
          await vscode.workspace.fs.readFile(document.uri),
        ).toString("utf8");
        let events;
        try {
          events = JSON.parse(text).events;
          if (
            !Array.isArray(events) ||
            !events.length ||
            events.length > 10000 ||
            !events.every(
              (e) =>
                e &&
                types.includes(e.type) &&
                e.session &&
                ["session", "name", "agent", "parent", "tool", "detail"].every(
                  (k) => typeof e[k] === "string" && e[k].length <= 180,
                ),
            )
          )
            throw Error();
        } catch {
          view.webview.html =
            "<p>O arquivo não contém uma sessão válida do Mapa de agentes.</p>";
          return;
        }
        view.webview.onDidReceiveMessage((message) => {
          if (message.type === "ready")
            view.webview.postMessage({ type: "recording", events });
        });
        await renderView(view, context, media);
      },
    }),
  );
  const config = configPath();
  if (config && vscode.workspace.isTrusted) {
    try {
      await fs.access(config);
    } catch (err) {
      if (err.code === "ENOENT") return;
      throw err;
    }
    await openMap(true);
  }
}
module.exports = { activate };
