"use strict";
const api = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;
const el = (id) => document.getElementById(id);
const sessions = new Map();
// O Copilot usa tanto o ID da sessão principal quanto o da sessão do subagente.
const sessionParents = new Map();
let received = [];
function rootSession(id) {
  const seen = new Set();
  while (sessionParents.has(id) && !seen.has(id)) {
    seen.add(id);
    id = sessionParents.get(id);
  }
  return id;
}
function resetSessions() {
  sessions.clear();
  sessionParents.clear();
  received = [];
}
function ingest(batch) {
  let regroup = false;
  for (const event of batch) {
    const parent =
      event.parent || (event.session !== event.agent ? event.session : null);
    if (
      event.agent &&
      parent &&
      parent !== event.agent &&
      !sessionParents.has(event.agent)
    ) {
      if (sessions.has(event.agent)) regroup = true;
      sessionParents.set(event.agent, parent);
    }
    received.push(event);
  }
  if (regroup) sessions.clear();
  for (const event of regroup ? received : batch)
    consume({ ...event, session: rootSession(event.agent || event.session) });
}
const svgNS = "http://www.w3.org/2000/svg";
let mode = "demo",
  current = "demo",
  selected = "a:testes",
  timer,
  recording;
const demo = [
  ["sessionStart", "", "Desenvolvimento"],
  ["subagentStart", "backend", "Backend", "$"],
  ["subagentStart", "revisao", "Revisão", "$"],
  ["preToolUse", "revisao", "Revisão", "$", "read_file", "src/routes.py"],
  ["preToolUse", "backend", "Backend", "$", "edit_file", "auth.py"],
  ["subagentStart", "testes", "Testes", "backend"],
  [
    "preToolUse",
    "testes",
    "Testes",
    "backend",
    "terminal",
    "pytest tests/test_auth.py",
  ],
  ["postToolUse", "revisao", "Revisão", "$", "read_file", "src/routes.py"],
  ["subagentStop", "revisao", "Revisão", "$"],
  [
    "postToolUse",
    "testes",
    "Testes",
    "backend",
    "terminal",
    "pytest tests/test_auth.py",
  ],
  ["subagentStop", "testes", "Testes", "backend"],
  ["postToolUse", "backend", "Backend", "$", "edit_file", "auth.py"],
  ["subagentStop", "backend", "Backend", "$"],
  ["sessionEnd"],
].map(([type, agent, name, parent, tool, detail]) => ({
  session: "demo",
  type,
  agent,
  name,
  parent,
  tool,
  detail,
}));

function makeNode(id, name) {
  return {
    id,
    name,
    parent: null,
    status: "Em sessão",
    active: [],
    last: "",
    tools: new Set(),
  };
}
function consume(e) {
  if (!sessions.has(e.session))
    sessions.set(e.session, new Map([["$", makeNode("$", "Sessão Copilot")]]));
  const nodes = sessions.get(e.session);
  const id = e.agent ? "a:" + e.agent : "$";
  if (!nodes.has(id)) nodes.set(id, makeNode(id, e.name || e.agent));
  const n = nodes.get(id);
  if (e.name && (e.agent || e.type === "sessionStart")) n.name = e.name;
  if (e.agent && e.parent) {
    n.parent =
      e.parent === e.session || (e.parent === "$" && mode === "demo")
        ? "$"
        : "a:" + e.parent;
    if (!nodes.has(n.parent)) nodes.set(n.parent, makeNode(n.parent, e.parent));
  }
  if (e.type === "subagentStart" || e.type === "subagentStop") {
    if (!e.agent) {
      n.last =
        (e.name || "Subagente") +
        (e.type === "subagentStart"
          ? " · início observado"
          : " · término observado");
      return;
    }
    n.status = e.type === "subagentStart" ? "Em execução" : "Concluído";
    if (e.type === "subagentStop") n.active = [];
  } else if (e.type === "preToolUse") {
    n.status = "Em execução";
    n.active.push({ tool: e.tool, detail: e.detail });
    n.tools.add([e.tool, e.detail].filter(Boolean).join(" · "));
  } else if (e.type === "postToolUse" || e.type === "postToolUseFailure") {
    const index = n.active.findIndex(
      (a) => a.tool === e.tool && (!e.detail || a.detail === e.detail),
    );
    if (index >= 0) n.active.splice(index, 1);
    n.last = [
      e.tool,
      e.detail,
      e.type === "postToolUse" ? "concluída" : "falhou",
    ]
      .filter(Boolean)
      .join(" · ");
  } else if (e.type === "sessionEnd") {
    for (const item of nodes.values()) {
      item.active = [];
      if (item.status !== "Concluído") item.status = "Sessão encerrada";
    }
  } else if (e.type === "sessionStart") n.status = "Em sessão";
}
function shape(tag, attrs, target) {
  const item = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attrs))
    item.setAttribute(key, value);
  target.append(item);
  return item;
}
function span(cls, value) {
  const s = document.createElement("span");
  s.className = cls;
  s.textContent = value;
  return s;
}
function inspect(nodes) {
  const n = nodes.get(selected) || nodes.values().next().value;
  if (!n) return;
  selected = n.id;
  for (const card of el("nodes").children) {
    const chosen = card.dataset.id === selected;
    card.classList.toggle("chosen", chosen);
    card.setAttribute("aria-pressed", String(chosen));
  }
  el("selected").textContent = n.name;
  el("activityLabel").textContent = n.active.length
    ? "Ferramenta em execução"
    : "Última atividade";
  el("activity").textContent =
    n.active
      .map((t) => [t.tool, t.detail].filter(Boolean).join(" · "))
      .join("\n") ||
    n.last ||
    n.status;
  el("history").textContent = Array.from(n.tools).join("\n") || "—";
  el("parent").textContent =
    nodes.get(n.parent)?.name ||
    (n.id === "$" ? "Agente principal" : "Origem não informada");
}
function render() {
  const nodes = sessions.get(current);
  const empty = !nodes?.size;
  el("empty").hidden = !empty;
  el("canvas").hidden = el("detail").hidden = empty;
  el("count").textContent = empty
    ? ""
    : nodes.size + (nodes.size === 1 ? " nó" : " nós");
  if (empty) return;
  const focusId = document.activeElement?.dataset.id;
  const children = new Map(),
    positions = new Map();
  for (const n of nodes.values()) {
    if (!children.has(n.parent)) children.set(n.parent, []);
    children.get(n.parent).push(n);
  }
  let row = 0;
  function position(n, depth) {
    if (positions.has(n.id)) return null;
    const p = { depth, row: 0 };
    positions.set(n.id, p);
    const rows = (children.get(n.id) || [])
      .map((child) => position(child, depth + 1))
      .filter((r) => r !== null);
    p.row = rows.length ? (rows[0] + rows[rows.length - 1]) / 2 : row++;
    return p.row;
  }
  for (const n of nodes.values()) if (!nodes.has(n.parent)) position(n, 0);
  for (const n of nodes.values()) position(n, 0);
  const cols = Math.max(...Array.from(positions.values(), (p) => p.depth)) + 1;
  const step = Math.max(
    250,
    Math.min(
      348,
      (el("canvas").parentElement.clientWidth - 268) / Math.max(1, cols - 1),
    ),
  );
  const width = 268 + (cols - 1) * step,
    height = 150 + (row - 1) * 148;
  Object.assign(el("canvas").style, {
    width: width + "px",
    height: height + "px",
  });
  el("nodes").replaceChildren();
  el("edges").replaceChildren();
  const marker = shape(
    "marker",
    {
      id: "arrow",
      viewBox: "0 0 10 10",
      refX: 9,
      refY: 5,
      markerWidth: 6,
      markerHeight: 6,
      orient: "auto",
    },
    shape("defs", {}, el("edges")),
  );
  shape("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#39c9c2" }, marker);
  for (const n of nodes.values()) {
    const p = positions.get(n.id),
      x = 24 + p.depth * step,
      y = 26 + p.row * 148;
    const parent = positions.get(n.parent);
    if (parent && parent.depth < p.depth) {
      const sx = 244 + parent.depth * step,
        sy = 73 + parent.row * 148,
        mid = (sx + x) / 2;
      const d =
        "M " +
        sx +
        " " +
        sy +
        " C " +
        mid +
        " " +
        sy +
        " " +
        mid +
        " " +
        (y + 47) +
        " " +
        x +
        " " +
        (y + 47);
      shape(
        "path",
        { d, class: "wire", "marker-end": "url(#arrow)" },
        el("edges"),
      );
      if (n.status === "Em execução")
        shape("path", { d, class: "flow" }, el("edges"));
    }
    const card = document.createElement("button"),
      done = ["Concluído", "Sessão encerrada"].includes(n.status);
    card.className = "node" + (done ? " done" : "");
    card.dataset.id = n.id;
    Object.assign(card.style, { left: x + "px", top: y + "px" });
    const text = span("copy", ""),
      tool = n.active.at(-1);
    const label = tool
      ? [tool.tool, tool.detail].filter(Boolean).join(" · ")
      : n.id === "$" && children.get("$")?.length && !done
        ? "Orquestrador"
        : n.status;
    text.append(span("name", n.name), span("badge", label));
    if (done && n.tools.size) {
      const tools = Array.from(n.tools).filter((t) => t !== "tool_search_tool");
      text.append(span("used", tools.join("  /  ")));
    }
    card.title = n.name + " · " + label;
    card.append(span("sigil", done ? "✓" : n.id === "$" ? "◎" : "◇"), text);
    card.onclick = () => {
      selected = n.id;
      inspect(nodes);
    };
    el("nodes").append(card);
    if (focusId === n.id) card.focus({ preventScroll: true });
  }
  inspect(nodes);
}
function resetDemo() {
  clearInterval(timer);
  resetSessions();
  mode = "demo";
  current = "demo";
  selected = "a:testes";
  el("mode").textContent = "Sessão simulada";
  el("sessions").hidden = true;
  el("live").hidden = !api;
  el("live").textContent = "Sessão real";
  el("play").textContent = "Reproduzir demo";
  demo.slice(0, 9).forEach(consume);
  render();
}
el("play").onclick = () => {
  if (mode === "live") {
    api.postMessage({ type: "demo" });
    resetDemo();
    return;
  }
  clearInterval(timer);
  const sequence = mode === "recording" ? recording : demo;
  resetSessions();
  selected = "$";
  let i = 0;
  function tick() {
    const event = sequence[i++];
    if (mode === "recording") ingest([event]);
    else consume(event);
    if (event.type === "preToolUse")
      selected = event.agent ? "a:" + event.agent : "$";
    render();
    if (i === sequence.length) {
      clearInterval(timer);
      el("play").textContent =
        mode === "recording" ? "Rever execução" : "Reproduzir demo";
    }
  }
  el("play").textContent =
    mode === "recording" ? "Reiniciar reprodução" : "Reiniciar demo";
  tick();
  timer = setInterval(tick, 1300);
};
el("sessions").onchange = () => {
  current = el("sessions").value;
  selected = "$";
  render();
};
el("live").hidden = !api;
el("live").onclick = () => api.postMessage({ type: "live" });
window.addEventListener("message", ({ data }) => {
  if (data.type === "recording") {
    clearInterval(timer);
    resetSessions();
    mode = "recording";
    recording = data.events;
    current = recording[0].session;
    selected = "$";
    ingest(recording);
    current = rootSession(current);
    el("mode").textContent = "Execução gravada · " + current.slice(0, 12);
    el("play").textContent = "Rever execução";
    el("sessions").hidden = el("live").hidden = true;
    render();
    return;
  }
  if (data.type === "listening") {
    clearInterval(timer);
    mode = "live";
    resetSessions();
    current = "";
    selected = "$";
    el("sessions").replaceChildren();
    el("sessions").hidden = true;
    el("mode").textContent = "Sessão real · " + data.folder;
    el("live").hidden = true;
    el("play").textContent = "Voltar à demo";
    render();
  }
  if (mode !== "live" || data.type !== "events") return;
  const previousRoots = new Set(sessions.keys());
  ingest(data.events);
  current = rootSession(current);
  for (const root of sessions.keys()) {
    if (!previousRoots.has(root)) {
      current = root;
      selected = "$";
    }
  }
  const picker = el("sessions");
  picker.replaceChildren(
    ...Array.from(
      sessions.keys(),
      (id) => new Option("Sessão " + id.slice(0, 12), id),
    ),
  );
  picker.value = current;
  picker.hidden = sessions.size < 2;
  render();
});
window.addEventListener("resize", render);
resetDemo();
api?.postMessage({ type: "ready" });
