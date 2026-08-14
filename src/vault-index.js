const path = require("path");
const vscode = require("vscode");

const EXCLUDED_DIRECTORIES = new Set([".git", ".obsidian", "node_modules"]);
const decoder = new TextDecoder("utf-8");

function targetFromLink(value) {
  return value.trim().replace(/^!/, "").split("|")[0].split("#")[0].trim();
}

function extractTargets(content) {
  const targets = [];
  for (const match of content.matchAll(/!?\[\[([^\]]+)\]\]/g))
    targets.push(targetFromLink(match[1]));
  for (const match of content.matchAll(
    /(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g,
  )) {
    if (/^(?:https?:|mailto:|#)/i.test(match[1])) continue;
    try {
      targets.push(targetFromLink(decodeURIComponent(match[1])));
    } catch {
      targets.push(targetFromLink(match[1]));
    }
  }
  return targets.filter(Boolean);
}

async function collectMarkdownFiles(root) {
  const result = [];
  async function visit(folder) {
    try {
      const entries = await vscode.workspace.fs.readDirectory(folder);
      await Promise.all(
        entries.map(async ([name, type]) => {
          const item = vscode.Uri.joinPath(folder, name);
          if (
            type === vscode.FileType.Directory &&
            !EXCLUDED_DIRECTORIES.has(name)
          )
            return visit(item);
          if (type === vscode.FileType.File && name.toLowerCase().endsWith(".md"))
            result.push(item);
        }),
      );
    } catch (error) {
      console.error(`Could not read directory ${folder.fsPath}: ${error.message}`);
    }
  }
  await visit(root);
  return result;
}

class VaultIndex {
  static async load(root) {
    const files = await collectMarkdownFiles(root);
    const notes = await Promise.all(
      files.map(async (uri) => ({
        uri,
        path: path.relative(root.fsPath, uri.fsPath).replace(/\\/g, "/"),
        content: decoder.decode(await vscode.workspace.fs.readFile(uri)),
      })),
    );
    return new VaultIndex(root, notes);
  }

  constructor(root, notes) {
    this.root = root;
    this.notes = notes;
    this.byPath = new Map();
    this.byBasename = new Map();
    for (const note of notes) {
      const withoutExtension = note.path.replace(/\.md$/i, "");
      this.byPath.set(note.path.toLowerCase(), note);
      this.byPath.set(withoutExtension.toLowerCase(), note);
      const basename = path.posix.basename(withoutExtension).toLowerCase();
      if (!this.byBasename.has(basename)) this.byBasename.set(basename, note);
    }
  }

  contains(uri) {
    const relative = path.relative(this.root.fsPath, uri.fsPath);
    return !relative.startsWith("..") && !path.isAbsolute(relative);
  }

  resolve(sourceUri, target) {
    if (!this.contains(sourceUri)) return undefined;
    const source = path
      .relative(this.root.fsPath, sourceUri.fsPath)
      .replace(/\\/g, "/");
    const cleaned = targetFromLink(target);
    const directory = path.posix.dirname(source);
    const relativeTarget = path.posix
      .normalize(path.posix.join(directory === "." ? "" : directory, cleaned))
      .replace(/^\.\//, "");
    return (
      this.byPath.get(relativeTarget.toLowerCase()) ||
      this.byPath.get(cleaned.toLowerCase()) ||
      this.byBasename.get(
        path.posix.basename(cleaned).replace(/\.md$/i, "").toLowerCase(),
      )
    );
  }

  graph() {
    const nodes = new Map(
      this.notes.map((note) => [
        note.path,
        {
          id: note.path,
          label: path.posix.basename(note.path).replace(/\.md$/i, ""),
          folder: path.posix.dirname(note.path.replace(/\\/g, "/")),
          missing: false,
        },
      ]),
    );
    const edges = new Map();
    for (const note of this.notes)
      for (const target of extractTargets(note.content)) {
        const resolved = this.resolve(note.uri, target);
        const id = resolved ? resolved.path : `missing:${target}`;
        if (!nodes.has(id))
          nodes.set(id, { id, label: target, missing: true, folder: "." });
        edges.set(`${note.path}\u0000${id}`, {
          source: note.path,
          target: id,
        });
      }
    return { nodes: [...nodes.values()], edges: [...edges.values()] };
  }

  noteForId(id) {
    return this.byPath.get(id.toLowerCase());
  }
}

module.exports = { VaultIndex };
