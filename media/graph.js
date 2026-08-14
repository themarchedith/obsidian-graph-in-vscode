const vscode = acquireVsCodeApi();
const host = document.querySelector("#graph");
const controls = Object.fromEntries([...document.querySelectorAll("input")].map((input) => [input.id, input]));
const defaults = { existing: false, orphans: true, labels: true, nodeSize: 100, linkWidth: 100, centerForce: 28, repelForce: 85, linkForce: 80, linkDistance: 100 };
let app;
let container;
let nodes = [];
let edges = [];
let simulation;
let zoomHandler;
let hoverId;
let viewport = { x: 0, y: 0, k: 1 };
let dragStart;
let pendingGraph = null;
let resizeObserver;
const nodeShapes = new Map();
const edgeShapes = new Map();
const labels = new Map();
const adjacency = new Map();
const degrees = new Map();

function option(name) {
  const control = controls[name];
  return control.type === "checkbox" ? control.checked : Number(control.value);
}

function viewportSize() {
  return { width: Math.max(1, host.clientWidth), height: Math.max(1, host.clientHeight) };
}

function color(folder) {
  let hash = 0;
  for (const char of folder || "") hash = char.charCodeAt(0) + ((hash << 5) - hash);
  const hue = (Math.abs(hash) % 360) / 60;
  const chroma = 0.56;
  const secondary = chroma * (1 - Math.abs((hue % 2) - 1));
  const match = 0.32;
  const [red, green, blue] = hue < 1 ? [chroma, secondary, 0]
    : hue < 2 ? [secondary, chroma, 0]
    : hue < 3 ? [0, chroma, secondary]
    : hue < 4 ? [0, secondary, chroma]
    : hue < 5 ? [secondary, 0, chroma]
    : [chroma, 0, secondary];
  return (Math.round((red + match) * 255) << 16) |
    (Math.round((green + match) * 255) << 8) |
    Math.round((blue + match) * 255);
}

function nodeVisible(node) {
  if (option("existing") && node.missing) return false;
  if (!option("orphans") && !(degrees.get(node.id) > 0)) return false;
  const query = controls.search.value.trim().toLowerCase();
  return !query || node.label.toLowerCase().includes(query);
}

function edgeKey(edge) {
  return `${edge.source.id}\u0000${edge.target.id}`;
}

function shape(map, id, make) {
  if (!map.has(id)) {
    const item = make();
    map.set(id, item);
    container.addChild(item);
  }
  return map.get(id);
}

function removeStaleShapes(map, ids) {
  for (const [id, item] of map) {
    if (ids.has(id)) continue;
    item.removeFromParent();
    item.destroy();
    map.delete(id);
  }
}

function rebuildTopology() {
  adjacency.clear();
  degrees.clear();
  for (const node of nodes) {
    adjacency.set(node.id, new Set());
    degrees.set(node.id, 0);
  }
  for (const edge of edges) {
    if (!edge.source || !edge.target) continue;
    adjacency.get(edge.source.id)?.add(edge.target.id);
    adjacency.get(edge.target.id)?.add(edge.source.id);
    degrees.set(edge.source.id, (degrees.get(edge.source.id) || 0) + 1);
    degrees.set(edge.target.id, (degrees.get(edge.target.id) || 0) + 1);
  }
}

function relatedNodes() {
  if (!hoverId) return undefined;
  return new Set([hoverId, ...(adjacency.get(hoverId) || [])]);
}

function draw() {
  if (!app || !container) return;
  const related = relatedNodes();
  const edgeIds = new Set();
  const nodeIds = new Set();

  for (const edge of edges) {
    const id = edgeKey(edge);
    edgeIds.add(id);
    const graphic = shape(edgeShapes, id, () => new PIXI.Graphics());
    const visible = nodeVisible(edge.source) && nodeVisible(edge.target);
    graphic.visible = visible;
    if (!visible) continue;
    const active = !related || (related.has(edge.source.id) && related.has(edge.target.id));
    graphic.clear();
    graphic.lineStyle(option("linkWidth") / 100, 0x7c8b98, active ? 0.6 : 0.1);
    graphic.moveTo(edge.source.x || 0, edge.source.y || 0);
    graphic.lineTo(edge.target.x || 0, edge.target.y || 0);
  }

  for (const node of nodes) {
    nodeIds.add(node.id);
    const graphic = shape(nodeShapes, node.id, () => new PIXI.Graphics());
    const label = shape(labels, node.id, () => new PIXI.Text(node.label, { fontFamily: "var(--vscode-font-family)", fontSize: 11, fill: 0xd0d0d0 }));
    const visible = nodeVisible(node);
    graphic.visible = visible;
    label.visible = false;
    if (!visible) continue;
    const degree = degrees.get(node.id) || 0;
    const radius = (5 + Math.min(12, Math.sqrt(degree) * 3)) * option("nodeSize") / 100;
    const active = !related || related.has(node.id);
    const alpha = related && !active ? 0.12 : 1;
    graphic.clear();
    graphic.lineStyle(active ? 2 : 1, active ? 0xffffff : 0xc8bdff, alpha);
    graphic.beginFill(node.missing ? 0x767676 : active ? 0xffffff : color(node.folder), alpha);
    graphic.drawCircle(0, 0, radius);
    graphic.endFill();
    graphic.position.set(node.x || 0, node.y || 0);
    label.visible = option("labels") && viewport.k > 0.45;
    label.alpha = alpha;
    label.position.set((node.x || 0) + radius + 4, (node.y || 0) - 6);
  }

  removeStaleShapes(edgeShapes, edgeIds);
  removeStaleShapes(nodeShapes, nodeIds);
  removeStaleShapes(labels, nodeIds);
}

function graphPoint(event) {
  const rect = app.view.getBoundingClientRect();
  return { x: (event.clientX - rect.left - viewport.x) / viewport.k, y: (event.clientY - rect.top - viewport.y) / viewport.k };
}

function nodeAt(point) {
  let closest;
  let closestDistance = Infinity;
  for (const node of nodes) {
    if (!nodeVisible(node)) continue;
    const radius = (5 + Math.min(12, Math.sqrt(degrees.get(node.id) || 0) * 3)) * option("nodeSize") / 100 + 8;
    const distance = Math.hypot((node.x || 0) - point.x, (node.y || 0) - point.y);
    if (distance <= radius && distance < closestDistance) {
      closest = node;
      closestDistance = distance;
    }
  }
  return closest;
}

function distanceToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
  const x = a.x + t * dx;
  const y = a.y + t * dy;
  return Math.hypot(point.x - x, point.y - y);
}

function edgeAt(point) {
  let closest;
  let closestDistance = Infinity;
  const tolerance = Math.max(7, 6 / viewport.k);
  for (const edge of edges) {
    if (!nodeVisible(edge.source) || !nodeVisible(edge.target)) continue;
    const distance = distanceToSegment(point, { x: edge.source.x || 0, y: edge.source.y || 0 }, { x: edge.target.x || 0, y: edge.target.y || 0 });
    if (distance <= tolerance && distance < closestDistance) {
      closest = edge;
      closestDistance = distance;
    }
  }
  return closest;
}

function openGraphTarget(point) {
  const node = nodeAt(point);
  if (node) {
    vscode.postMessage({ type: "openNote", id: node.id });
    return true;
  }
  const edge = edgeAt(point);
  if (edge) {
    vscode.postMessage({ type: "openNote", id: edge.target.id });
    return true;
  }
  return false;
}

function fitGraph(duration = 300) {
  if (!app || !zoomHandler) return;
  const visibleNodes = nodes.filter(nodeVisible);
  const { width, height } = viewportSize();
  if (!visibleNodes.length) {
    d3.select(app.view).transition().duration(duration).call(zoomHandler.transform, d3.zoomIdentity);
    return;
  }
  const padding = 60;
  const xs = visibleNodes.map((node) => node.x || 0);
  const ys = visibleNodes.map((node) => node.y || 0);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const graphWidth = Math.max(maxX - minX, 1);
  const graphHeight = Math.max(maxY - minY, 1);
  const scale = Math.max(0.2, Math.min(4, Math.min((width - padding * 2) / graphWidth, (height - padding * 2) / graphHeight)));
  const x = width / 2 - ((minX + maxX) / 2) * scale;
  const y = height / 2 - ((minY + maxY) / 2) * scale;
  const transform = d3.zoomIdentity.translate(x, y).scale(scale);
  d3.select(app.view).transition().duration(duration).call(zoomHandler.transform, transform);
}

function createSimulation() {
  const { width, height } = viewportSize();
  const linkForce = d3.forceLink(edges).id((node) => node.id).distance(option("linkDistance")).strength(option("linkForce") / 100);
  return d3.forceSimulation(nodes)
    .force("link", linkForce)
    .force("charge", d3.forceManyBody().strength(-option("repelForce")))
    .force("center", d3.forceCenter(width / 2, height / 2).strength(option("centerForce") / 100))
    .force("collide", d3.forceCollide().radius((node) => 8 + Math.min(12, Math.sqrt(degrees.get(node.id) || 0) * 3) + 3).strength(0.8))
    .on("tick", draw);
}

function updateSimulationForces(restart = true) {
  if (!simulation) return;
  const { width, height } = viewportSize();
  simulation.force("link").distance(option("linkDistance")).strength(option("linkForce") / 100);
  simulation.force("charge").strength(-option("repelForce"));
  simulation.force("center").x(width / 2).y(height / 2).strength(option("centerForce") / 100);
  if (restart) simulation.alpha(0.5).restart();
}

function initialise(graph) {
  if (!app) { pendingGraph = graph; return; }
  try {
    simulation?.stop();
    hoverId = undefined;
    viewport = { x: 0, y: 0, k: 1 };
    nodes = (graph.nodes || []).map((node) => ({ ...node }));
    const byId = new Map(nodes.map((node) => [node.id, node]));
    edges = (graph.edges || []).map((edge) => ({ ...edge, source: byId.get(edge.source), target: byId.get(edge.target) })).filter((edge) => edge.source && edge.target);
    rebuildTopology();
    simulation = createSimulation();
    zoomHandler = d3.zoom().scaleExtent([0.2, 4]).on("zoom", (event) => {
      viewport = event.transform;
      container.position.set(viewport.x, viewport.y);
      container.scale.set(viewport.k);
      draw();
    });

    const selection = d3.select(app.view);
    selection.on(".zoom", null).call(zoomHandler);
    selection.call(d3.drag()
      .container(app.view)
      .subject((event) => nodeAt({ x: (event.x - viewport.x) / viewport.k, y: (event.y - viewport.y) / viewport.k }))
      .on("start", (event) => {
        if (!event.subject) return;
        dragStart = { x: event.x, y: event.y };
        simulation.alphaTarget(0.25).restart();
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
      })
      .on("drag", (event) => {
        if (!event.subject) return;
        event.subject.fx = (event.x - viewport.x) / viewport.k;
        event.subject.fy = (event.y - viewport.y) / viewport.k;
      })
      .on("end", (event) => {
        if (!event.subject) return;
        simulation.alphaTarget(0);
        event.subject.fx = null;
        event.subject.fy = null;
        dragStart = undefined;
      }));

    draw();
  } catch (error) {
    vscode.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

async function setup() {
  try {
    app = new PIXI.Application({ resizeTo: host, backgroundAlpha: 0, antialias: true, resolution: window.devicePixelRatio || 1, autoDensity: true });
    host.replaceChildren(app.view);
    container = new PIXI.Container();
    app.stage.addChild(container);

    resizeObserver = new ResizeObserver(() => {
      if (!simulation) return;
      updateSimulationForces(false);
      simulation.alpha(0.15).restart();
      draw();
    });
    resizeObserver.observe(host);

    let pointerDown;
    app.view.addEventListener("pointerdown", (event) => {
      const point = graphPoint(event);
      pointerDown = { x: event.clientX, y: event.clientY, point };
    });
    app.view.addEventListener("pointerup", (event) => {
      if (!pointerDown) return;
      const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
      const point = graphPoint(event);
      pointerDown = undefined;
      if (moved <= 5) openGraphTarget(point);
    });
    app.view.addEventListener("pointermove", (event) => {
      const node = nodeAt(graphPoint(event));
      if (node?.id !== hoverId) {
        hoverId = node?.id;
        draw();
      }
    });
    app.view.addEventListener("pointerleave", () => {
      pointerDown = undefined;
      if (hoverId !== undefined) {
        hoverId = undefined;
        draw();
      }
    });

    vscode.postMessage({ type: "ready" });
    if (pendingGraph) {
      const nextGraph = pendingGraph;
      pendingGraph = null;
      initialise(nextGraph);
      document.querySelector("#emptyState").hidden = true;
      document.querySelector("#status").textContent = `Vault selected: ${nextGraph.vaultPath || ""} · ${nextGraph.nodes.length} notes · ${nextGraph.edges.length} links`;
    }
  } catch (error) {
    vscode.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

document.querySelector("#chooseVault").onclick = () => vscode.postMessage({ type: "chooseVault" });
document.querySelector("#refresh").onclick = () => vscode.postMessage({ type: "refresh" });
document.querySelector("#fit").onclick = () => fitGraph();
document.querySelector("#settingsButton").onclick = () => {
  const settings = document.querySelector("#settings");
  settings.hidden = !settings.hidden;
};
document.querySelector("#closeSettings").onclick = () => { document.querySelector("#settings").hidden = true; };

for (const control of Object.values(controls)) {
  control.addEventListener("input", () => { updateSimulationForces(); draw(); });
}

document.querySelector("#reset").onclick = () => {
  for (const [name, value] of Object.entries(defaults)) {
    if (typeof value === "boolean") controls[name].checked = value;
    else controls[name].value = value;
  }
  updateSimulationForces();
  draw();
};

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

addEventListener("beforeunload", () => {
  simulation?.stop();
  resizeObserver?.disconnect();
  app?.destroy(true);
});

setup();
