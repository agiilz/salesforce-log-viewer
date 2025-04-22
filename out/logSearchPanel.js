"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LogSearchPanel = void 0;
const vscode = __importStar(require("vscode"));
class LogSearchPanel {
    constructor(panel, logDataProvider, extensionUri) {
        this.logDataProvider = logDataProvider;
        this.extensionUri = extensionUri;
        this._disposables = [];
        this._logs = [];
        this._panel = panel;
        this._logs = [];
        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'search':
                    await this._handleSearch(message.text);
                    return;
            }
        }, null, this._disposables);
    }
    static createOrShow(extensionUri, logDataProvider) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;
        if (LogSearchPanel.currentPanel) {
            LogSearchPanel.currentPanel._panel.reveal(column);
            return;
        }
        const panel = vscode.window.createWebviewPanel('logSearch', 'Search Logs', column || vscode.ViewColumn.One, {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(extensionUri, 'media')
            ]
        });
        LogSearchPanel.currentPanel = new LogSearchPanel(panel, logDataProvider, extensionUri);
    }
    async _handleSearch(searchText) {
        this._logs = await this.logDataProvider.searchLogs(searchText);
        await this._update();
    }
    async _update() {
        const webview = this._panel.webview;
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }
    _getHtmlForWebview(webview) {
        const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'reset.css'));
        const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'vscode.css'));
        const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.css'));
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="${styleResetUri}" rel="stylesheet">
            <link href="${styleVSCodeUri}" rel="stylesheet">
            <link href="${styleMainUri}" rel="stylesheet">
            <title>Search Logs</title>
        </head>
        <body>
            <div class="search-container">
                <input type="text" id="searchInput" placeholder="Search in logs..." class="search-input">
            </div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>User</th>
                            <th>Operation</th>
                            <th>Time</th>
                            <th>Status</th>
                            <th>Size</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this._logs.map(log => `
                            <tr class="log-row" data-id="${log.id}">
                                <td>${log.user}</td>
                                <td>${log.operation}</td>
                                <td>${new Date(log.startTime).toLocaleTimeString()}</td>
                                <td>${log.status}</td>
                                <td>${(log.size / 1024).toFixed(1)}KB</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                const searchInput = document.getElementById('searchInput');
                
                let debounceTimeout;
                searchInput.addEventListener('input', () => {
                    clearTimeout(debounceTimeout);
                    debounceTimeout = setTimeout(() => {
                        vscode.postMessage({
                            command: 'search',
                            text: searchInput.value
                        });
                    }, 300);
                });

                document.querySelectorAll('.log-row').forEach(row => {
                    row.addEventListener('click', () => {
                        vscode.postMessage({
                            command: 'openLog',
                            logId: row.dataset.id
                        });
                    });
                });
            </script>
        </body>
        </html>`;
    }
    dispose() {
        LogSearchPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
exports.LogSearchPanel = LogSearchPanel;
//# sourceMappingURL=logSearchPanel.js.map