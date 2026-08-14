const vscode = require("vscode");

class GraphPanel {
  constructor(extensionUri, onMessage) {
    this.extensionUri = extensionUri;
    this.onMessage = onMessage;
    this.panel = undefined;
    this.ready = false;
    this.pendingMessages = [];
  }
  flushPending() {
    if (!this.panel || !this.ready) return;
    while (this.pendingMessages.length > 0) {
      const message = this.pendingMessages.shift();
      this.panel.webview.postMessage(message);
    }
  }
  show() {
    if (this.panel) return this.panel.reveal();
    this.panel = vscode.window.createWebviewPanel("obsidianVaultGraph", "Obsidian Vault Graph", vscode.ViewColumn.One, { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")] });
    this.panel.webview.html = this.html(this.panel.webview);
    this.panel.webview.onDidReceiveMessage((message) => {
      if (message.type === "ready") {
        this.ready = true;
        this.flushPending();
      }
      this.onMessage(message);
    });
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.ready = false;
      this.pendingMessages = [];
    });
  }
  postGraph(graph, vaultPath) {
    const message = { type: "graph", graph, vaultPath };
    if (!this.panel) return;
    if (!this.ready) {
      this.pendingMessages.push(message);
      return;
    }
    this.panel.webview.postMessage(message);
  }
  postVaultStatus(vaultPath) {
    const message = { type: "vaultStatus", vaultPath };
    if (!this.panel) return;
    if (!this.ready) {
      this.pendingMessages.push(message);
      return;
    }
    this.panel.webview.postMessage(message);
  }
  html(webview) {
    const nonce = String(Date.now());
    const asset = (name) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", name));
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}' 'unsafe-eval';"><link rel="stylesheet" href="${asset("graph.css")}"></head><body><header><button id="chooseVault">Choose vault</button><button id="refresh">Refresh</button><button id="fit">Fit graph</button><button id="settingsButton" aria-expanded="false">Settings</button><span id="status">No vault selected</span></header><main><div id="graph" tabindex="0" aria-label="Obsidian vault graph"></div><p id="emptyState">No vault selected. Choose an Obsidian vault folder to render its links.</p></main><aside id="settings" hidden><div class="settings-header"><strong>Graph settings</strong><button id="closeSettings">← Back to graph</button></div><section><h2>Filters</h2><input id="search" type="search" placeholder="Search files"><label><input id="existing" type="checkbox"> Existing files only</label><label><input id="orphans" type="checkbox" checked> Show orphans</label></section><section><h2>Display</h2><label><input id="labels" type="checkbox" checked> Show labels</label><label>Node size<input id="nodeSize" type="range" min="50" max="180" value="100"></label><label>Link thickness<input id="linkWidth" type="range" min="50" max="250" value="100"></label></section><section><h2>Forces</h2><label>Center force<input id="centerForce" type="range" min="0" max="100" value="28"></label><label>Repel force<input id="repelForce" type="range" min="0" max="180" value="85"></label><label>Link force<input id="linkForce" type="range" min="0" max="100" value="80"></label><label>Link distance<input id="linkDistance" type="range" min="40" max="320" value="100"></label></section><button id="reset">Restore default settings</button><p class="help">Scroll to zoom. Drag the background to pan. Drag a note to reposition it. Click a note to open it.</p></aside><script nonce="${nonce}" src="${asset("pixi.min.js")}"></script><script nonce="${nonce}" src="${asset("d3.min.js")}"></script><script nonce="${nonce}" src="${asset("graph.js")}"></script></body></html>`;
  }
}

module.exports = { GraphPanel };
