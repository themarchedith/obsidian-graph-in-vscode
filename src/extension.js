const vscode = require("vscode");
const { GraphPanel } = require("./graph-panel");
const { VaultIndex } = require("./vault-index");
const { createWikiLinkProvider } = require("./wiki-links");

let index;
let panel;
let watcher;
let refreshTimer;
let refreshInFlight = null;
let refreshQueued = false;
let extensionContext;

function configuredVault() {
  const value = vscode.workspace
    .getConfiguration("obsidianVaultGraph")
    .get("vaultPath");
  return value ? vscode.Uri.file(value) : undefined;
}

async function isLikelyVault(uri) {
  try {
    const stat = await vscode.workspace.fs.stat(
      vscode.Uri.joinPath(uri, ".obsidian"),
    );
    return stat.type === vscode.FileType.Directory;
  } catch {
    return false;
  }
}

async function loadVault(uri) {
  const nextIndex = await VaultIndex.load(uri);
  index = nextIndex;
  return nextIndex;
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshGraph();
  }, 250);
}

function watchVault(uri, context) {
  watcher?.dispose();
  watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(uri, "**/*.md"),
  );
  watcher.onDidChange(scheduleRefresh, undefined, context.subscriptions);
  watcher.onDidCreate(scheduleRefresh, undefined, context.subscriptions);
  watcher.onDidDelete(scheduleRefresh, undefined, context.subscriptions);
  context.subscriptions.push(watcher);
}

async function refreshGraph() {
  if (refreshInFlight) {
    refreshQueued = true;
    return refreshInFlight;
  }

  const vault = configuredVault();
  if (!vault || !panel) return;

  refreshInFlight = (async () => {
    try {
      const current = await loadVault(vault);
      if (!panel) return;
      const graph = current.graph();
      console.log(`Refreshing graph with ${graph.nodes.length} nodes`);
      panel.postGraph(graph, vault.fsPath);
    } catch (error) {
      vscode.window.showErrorMessage(
        `Obsidian Vault Graph could not read this vault: ${error.message}`,
      );
    } finally {
      refreshInFlight = null;
      if (refreshQueued) {
        refreshQueued = false;
        scheduleRefresh();
      }
    }
  })();

  return refreshInFlight;
}

async function chooseVault(context) {
  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Use as Obsidian vault",
  });
  if (!selected) return;

  const folder = selected[0];
  if (!(await isLikelyVault(folder))) {
    vscode.window.showErrorMessage(
      "That folder does not look like an Obsidian vault. Please choose a vault folder that contains a .obsidian directory.",
    );
    return;
  }

  await vscode.workspace
    .getConfiguration("obsidianVaultGraph")
    .update("vaultPath", folder.fsPath, vscode.ConfigurationTarget.Global);
  watchVault(folder, context);
  panel.show();
  panel.postVaultStatus(folder.fsPath);
  await refreshGraph();
}

function activate(context) {
  extensionContext = context;
  panel = new GraphPanel(context.extensionUri, async (message) => {
    if (message.type === "ready" || message.type === "refresh") {
      await refreshGraph();
    } else if (message.type === "chooseVault") {
      await chooseVault(context);
    } else if (message.type === "error") {
      console.error(`Webview error: ${message.message}`);
      vscode.window.showErrorMessage(`Webview error: ${message.message}`);
    } else if (message.type === "openNote") {
      const note = index?.noteForId(message.id);
      if (note)
        await vscode.window.showTextDocument(
          await vscode.workspace.openTextDocument(note.uri),
        );
    }
  });

  const configured = configuredVault();
  if (configured) {
    watchVault(configured, context);
    loadVault(configured).catch((error) => {
      console.warn(`Could not load configured vault: ${error.message}`);
    });
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("obsidianVaultGraph.open", async () => {
      panel.show();
      if (configuredVault()) await refreshGraph();
      else await chooseVault(context);
    }),
    vscode.commands.registerCommand("obsidianVaultGraph.chooseVault", () =>
      chooseVault(context),
    ),
    vscode.commands.registerCommand("obsidianVaultGraph.refresh", refreshGraph),
    vscode.languages.registerDocumentLinkProvider(
      { language: "markdown" },
      createWikiLinkProvider(async (uri) => {
        if (index?.contains(uri)) return index;
        const vault = configuredVault();
        if (!vault || !uri.fsPath.startsWith(vault.fsPath)) return undefined;
        try {
          return await loadVault(vault);
        } catch {
          return undefined;
        }
      }),
    ),
  );
}

function deactivate() {
  clearTimeout(refreshTimer);
  watcher?.dispose();
  refreshInFlight = null;
  refreshQueued = false;
  panel = undefined;
  index = undefined;
  extensionContext = undefined;
}

module.exports = { activate, deactivate };
