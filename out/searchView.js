"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SearchView = void 0;
class SearchView {
    constructor(extensionUri, logDataProvider) {
        this.extensionUri = extensionUri;
        this.logDataProvider = logDataProvider;
    }
    resolveWebviewView(webviewView, context, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        webviewView.webview.onDidReceiveMessage(data => {
            switch (data.type) {
                case 'search':
                    this.logDataProvider.setSearchFilter(data.value);
                    break;
            }
        });
    }
    _getHtmlForWebview(webview) {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                .search-container {
                    padding: 10px;
                    display: flex;
                }
                .search-input {
                    width: 100%;
                    padding: 4px 8px;
                    border: 1px solid var(--vscode-input-border);
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    outline: none;
                }
                .search-input:focus {
                    border-color: var(--vscode-focusBorder);
                }
            </style>
        </head>
        <body>
            <div class="search-container">
                <input 
                    type="text" 
                    class="search-input" 
                    placeholder="Filter logs by operation or username..."
                    id="search-input"
                >
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                const searchInput = document.getElementById('search-input');
                
                let debounceTimeout;
                searchInput.addEventListener('input', () => {
                    clearTimeout(debounceTimeout);
                    debounceTimeout = setTimeout(() => {
                        vscode.postMessage({
                            type: 'search',
                            value: searchInput.value
                        });
                    }, 300);
                });
            </script>
        </body>
        </html>`;
    }
}
exports.SearchView = SearchView;
//# sourceMappingURL=searchView.js.map