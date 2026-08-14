const vscode = require("vscode");

function createWikiLinkProvider(getIndex) {
  return {
    async provideDocumentLinks(document) {
      const index = await getIndex(document.uri);
      if (!index) return [];
      const links = [];
      for (const match of document.getText().matchAll(/!?\[\[([^\]]+)\]\]/g)) {
        if (match[0].startsWith("!")) continue;
        const note = index.resolve(document.uri, match[1]);
        if (!note) continue;
        const range = new vscode.Range(
          document.positionAt(match.index),
          document.positionAt(match.index + match[0].length),
        );
        links.push(new vscode.DocumentLink(range, note.uri));
      }
      return links;
    },
  };
}

module.exports = { createWikiLinkProvider };
