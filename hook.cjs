// O hook transmite apenas metadados ao painel aberto neste workspace.
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const types = [
  "sessionStart",
  "sessionEnd",
  "subagentStart",
  "subagentStop",
  "preToolUse",
  "postToolUse",
  "postToolUseFailure",
];
const field = (value) => (typeof value === "string" ? value.slice(0, 180) : "");
function normalize(type, p) {
  const session = field(p.sessionId || p.session_id);
  if (!session || !types.includes(type)) return;
  const tool = field(p.toolName || p.tool_name);
  let args = p.toolArgs || p.tool_input;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      args = null;
    }
  }
  const file = field(args?.filePath || args?.file_path || args?.path);
  return {
    type,
    session,
    agent: field(p.agentId || p.agent_id),
    parent: field(p.parentAgentId || p.parent_agent_id),
    name: field(
      p.agentDisplayName ||
        p.agent_display_name ||
        p.agentName ||
        p.agent_name ||
        p.agentType ||
        p.agent_type,
    ),
    tool,
    detail: file ? path.win32.basename(file) : "",
  };
}
async function deliver() {
  let json = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    if (json.length + chunk.length > 4 * 1024 * 1024) return;
    json += chunk;
  }
  const event = normalize(process.argv[2], JSON.parse(json));
  if (!event) return;
  const { socketPath, key } = JSON.parse(
    fs.readFileSync(process.env.MAPA_CONEXAO, "utf8"),
  );
  const req = http.request(
    {
      socketPath,
      method: "POST",
      path: "/event",
      headers: { authorization: "Bearer " + key },
    },
    (res) => res.resume(),
  );
  req.on("error", () => {});
  req.setTimeout(400, () => req.destroy());
  req.end(JSON.stringify(event));
}
if (require.main === module) deliver().catch(() => {});
module.exports = { types, normalize };
