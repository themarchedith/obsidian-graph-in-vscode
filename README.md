# Obsidian Vault Graph for VS Code

Open the Command Palette and run **Obsidian Vault Graph: Open Graph**, then choose an Obsidian vault folder. The extension recursively reads Markdown notes (excluding `.obsidian`, `.git`, and `node_modules`) and renders their wiki links and standard Markdown links as a force-directed, interactive graph.

It follows the core behavior documented in Obsidian's Graph view: notes are circles, links are lines, notes with more connections are larger, hover highlights neighbours, and clicking a note opens it in VS Code. The settings panel supports searching, hiding unresolved files or orphans, labels, directional arrows, node/link sizing, and resetting options. Drag the background to pan, scroll to zoom, drag a note to position it, and use `+`, `-`, arrow keys, or `Home` while the graph is focused.

The extension also resolves ordinary Obsidian `[[WikiLinks]]` in any Markdown file under the selected vault. Ctrl/Cmd-click a rendered link in the VS Code editor to open the target note (including relative, folder-qualified, and unqualified links).

Use **Choose Vault Folder** to switch vaults and **Refresh Graph** after changes. The selected absolute folder path is stored in the `obsidianVaultGraph.vaultPath` VS Code setting.

## Architecture

- `src/vault-index.js` scans a vault and resolves Obsidian-style links.
- `src/wiki-links.js` provides Ctrl/Cmd-click navigation for `[[WikiLinks]]` in VS Code Markdown editors.
- `src/graph-panel.js` owns the secure webview lifecycle and Content Security Policy.
- `media/graph.js` is the self-contained canvas renderer: interaction, filters, and the force layout live together.

The webview does not use runtime dependencies, inline scripts, or remote resources.

Author: @gaurav7902

## Run locally

Open `graph-extension-vscode` in VS Code and press `F5` to launch an Extension Development Host. This project intentionally has no runtime dependency or build step; `extension.js` is directly loaded by VS Code.
