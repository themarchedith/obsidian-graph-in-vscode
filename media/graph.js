const vscode = acquireVsCodeApi();
const host = document.querySelector("#graph");
const controls = Object.fromEntries([...document.querySelectorAll("input")].map((input) => [input.id, input]));
const defaults = { existing: false, orphans: true, labels: true, nodeSize: 100, linkWidth: 100, centerForce: 28, repelForce: 85, linkDistance: 100 };
let app, container, nodes = [], edges = [], simulation, zoomHandler, hoverId, viewport = { x: 0, y: 0, k: 1 }, dragStart;
let pendingGraph = null;
const nodeShapes = new Map(), edgeShapes = new Map(), labels = new Map();

function option(name) { return controls[name].type === "checkbox" ? controls[name].checked : Number(controls[name].value); }
function color(folder) {
  let hash = 0; for (const char of folder || "") hash = char.charCodeAt(0) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360 / 60, chroma = 0.56, secondary = chroma * (1 - Math.abs((hue % 2) - 1)), match = 0.32;
  const [red, green, blue] = hue < 1 ? [chroma, secondary, 0] : hue < 2 ? [secondary, chroma, 0] : hue < 3 ? [0, chroma, secondary] : hue < 4 ? [0, secondary, chroma] : hue < 5 ? [secondary, 0, chroma] : [chroma, 0, secondary];
  return (Math.round((red + match) * 255) << 16) | (Math.round((green + match) * 255) << 8) | Math.round((blue + match) * 255);
}
function visible(node) { return (!option("existing") || !node.missing) && (option("orphans") || edges.some((edge) => edge.source.id === node.id || edge.target.id === node.id)) && (!controls.search.value || node.label.toLowerCase().includes(controls.search.value.toLowerCase())); }
function key(edge) { return `${edge.source.id}\u0000${edge.target.id}`; }
function shape(map, id, make) { if (!map.has(id)) { const item = make(); map.set(id, item); container.addChild(item); } return map.get(id); }
function draw() {
  if (!app) return;
  const related = hoverId ? new Set([hoverId, ...edges.filter((edge) => edge.source.id === hoverId || edge.target.id === hoverId).flatMap((edge) => [edge.source.id, edge.target.id])]) : undefined;
  for (const edge of edges) {
    const graphic = shape(edgeShapes, key(edge), () => new PIXI.Graphics());
    graphic.clear(); graphic.visible = visible(edge.source) && visible(edge.target); if (!graphic.visible) continue;
    graphic.lineStyle(option("linkWidth") / 100, 0x7c8b98, related ? (related.has(edge.source.id) && related.has(edge.target.id) ? 0.6 : 0.1) : 0.42); graphic.moveTo(edge.source.x, edge.source.y); graphic.lineTo(edge.target.x, edge.target.y);
  }
  for (const node of nodes) {
    const graphic = shape(nodeShapes, node.id, () => new PIXI.Graphics());
    const label = shape(labels, node.id, () => new PIXI.Text(node.label, { fontFamily: "var(--vscode-font-family)", fontSize: 11, fill: 0xd0d0d0 }));
    graphic.clear(); graphic.visible = label.visible = visible(node); if (!graphic.visible) continue;
    const degree = edges.filter((edge) => edge.source.id === node.id || edge.target.id === node.id).length, radius = (5 + Math.min(12, Math.sqrt(degree) * 3)) * option("nodeSize") / 100, active = related?.has(node.id), alpha = related && !active ? 0.12 : 1;
    graphic.lineStyle(active ? 2 : 1, active ? 0xffffff : 0xc8bdff, alpha); graphic.beginFill(node.missing ? 0x767676 : active ? 0xffffff : color(node.folder), alpha); graphic.drawCircle(0, 0, radius); graphic.endFill(); graphic.position.set(node.x, node.y);
    label.visible = option("labels") && viewport.k > 0.45 && graphic.visible; label.alpha = alpha; label.position.set(node.x + radius + 4, node.y - 6);
  }
}
function initialise(graph) {
  if (!app) {
    pendingGraph = graph;
    return;
  }

  try {
    simulation?.stop(); nodes = graph.nodes.map((node) => ({ ...node })); const byId = new Map(nodes.map((node) => [node.id, node]));
    edges = graph.edges.map((edge) => ({ ...edge, source: byId.get(edge.source), target: byId.get(edge.target) })).filter((edge) => edge.source && edge.target);
    simulation = d3.forceSimulation(nodes).force("link", d3.forceLink(edges).id((node) => node.id).distance(option("linkDistance"))).force("charge", d3.forceManyBody().strength(-option("repelForce") * 10)).force("center", d3.forceCenter(app.renderer.width / 2, app.renderer.height / 2).strength(option("centerForce") / 100)).force("collide", d3.forceCollide(18)).on("tick", draw);
    zoomHandler = d3.zoom().scaleExtent([0.2, 4]).on("zoom", (event) => { viewport = event.transform; container.position.set(viewport.x, viewport.y); container.scale.set(viewport.k); });
    d3.select(app.view).on(".zoom", null).call(zoomHandler).call(d3.drag().container(app.view).subject((event) => nodes.find((node) => Math.hypot(node.x - (event.x - viewport.x) / viewport.k, node.y - (event.y - viewport.y) / viewport.k) < 20)).on("start", (event) => { if (!event.subject) return; dragStart = event; simulation.alphaTarget(0.3).restart(); event.subject.fx = event.subject.x; event.subject.fy = event.subject.y; }).on("drag", (event) => { if (event.subject) { event.subject.fx = (event.x - viewport.x) / viewport.k; event.subject.fy = (event.y - viewport.y) / viewport.k; } }).on("end", (event) => { if (!event.subject) return; simulation.alphaTarget(0); event.subject.fx = null; event.subject.fy = null; if (Math.hypot(event.x - dragStart.x, event.y - dragStart.y) < 2) vscode.postMessage({ type: "openNote", id: event.subject.id }); }));
  } catch (e) {
    vscode.postMessage({ type: "error", message: e.message });
    throw e;
  }
}
function setup() {
  app = new PIXI.Application({ resizeTo: host, backgroundAlpha: 0, antialias: true, resolution: devicePixelRatio || 1, autoDensity: true });
  host.replaceChildren(app.view); container = new PIXI.Container(); app.stage.addChild(container);
  new ResizeObserver(() => simulation?.alpha(0.3).restart()).observe(host);
  app.view.addEventListener("pointermove", (event) => { const rect = app.view.getBoundingClientRect(), node = nodes.find((item) => Math.hypot(item.x - (event.clientX - rect.left - viewport.x) / viewport.k, item.y - (event.clientY - rect.top - viewport.y) / viewport.k) < 20); if (node?.id !== hoverId) { hoverId = node?.id; draw(); } });
  vscode.postMessage({ type: "ready" });
  if (pendingGraph) {
    const nextGraph = pendingGraph;
    pendingGraph = null;
    initialise(nextGraph);
    document.querySelector("#emptyState").hidden = true;
    document.querySelector("#status").textContent = `Vault selected: ${nextGraph.vaultPath || ""} · ${nextGraph.nodes.length} notes · ${nextGraph.edges.length} links`;
  }
}
document.querySelector("#chooseVault").onclick = () => vscode.postMessage({ type: "chooseVault" }); document.querySelector("#refresh").onclick = () => vscode.postMessage({ type: "refresh" });
document.querySelector("#fit").onclick = () => d3.select(app.view).transition().duration(300).call(zoomHandler.transform, d3.zoomIdentity);
document.querySelector("#settingsButton").onclick = () => { const settings = document.querySelector("#settings"); settings.hidden = !settings.hidden; };
document.querySelector("#closeSettings").onclick = () => { document.querySelector("#settings").hidden = true; };
for (const control of Object.values(controls)) control.addEventListener("input", () => { if (simulation) { simulation.force("link").distance(option("linkDistance")); simulation.force("charge").strength(-option("repelForce") * 10); simulation.alpha(0.3).restart(); } draw(); });
document.querySelector("#reset").onclick = () => { for (const [name, value] of Object.entries(defaults)) controls[name].checked = typeof value === "boolean" ? value : (controls[name].value = value); draw(); };
addEventListener("message", (event) => {
  if (event.data.type === "vaultStatus") {
    document.querySelector("#status").textContent = `Vault selected: ${event.data.vaultPath}`;
    document.querySelector("#emptyState").textContent = "Loading graph...";
    document.querySelector("#emptyState").hidden = false;
    return;
  }
  if (event.data.type !== "graph") return;
  if (!app) {
    pendingGraph = event.data.graph;
    document.querySelector("#emptyState").textContent = "Initializing graph renderer...";
    return;
  }
  initialise(event.data.graph);
  document.querySelector("#emptyState").hidden = true;
  document.querySelector("#status").textContent = `Vault selected: ${event.data.vaultPath} · ${event.data.graph.nodes.length} notes · ${event.data.graph.edges.length} links`;
});
setup();
