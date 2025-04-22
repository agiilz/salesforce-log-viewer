import * as vscode from 'vscode';
import { Connection } from 'jsforce';
import { LogDataProvider } from './logDataProvider';
import { DeveloperLog } from './developerLog';
import * as fs from 'fs';
import * as path from 'path';

let logDataProvider: LogDataProvider | undefined;
let extensionContext: vscode.ExtensionContext;
let currentOrgUsername: string | undefined;

export async function activate(context: vscode.ExtensionContext) {
    extensionContext = context;
    const config = vscode.workspace.getConfiguration('salesforceLogViewer');

    try {
        // Get initial org username
        currentOrgUsername = vscode.workspace.getConfiguration('salesforce.sfdx-cli').get('defaultusername');

        // Create the log data provider first
        const logProvider = await getLogDataProvider();
        
        // Initial fetch of logs
        await logProvider.refreshLogs(true);
        console.log('Initial logs fetched:', logProvider.getGridData());

        // Create and register the webview provider
        const provider = new LogViewProvider(context.extensionUri, logProvider);
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider('salesforceLogsView', provider)
        );

    // Register commands
    context.subscriptions.push(
            vscode.commands.registerCommand('salesforce-log-viewer.refreshLogs', async () => {
                console.log('Refresh command triggered');
                await refreshLogs();
                provider.updateView();
            }),
        vscode.commands.registerCommand('salesforce-log-viewer.openLog', openLog),
        vscode.commands.registerCommand('salesforce-log-viewer.toggleCurrentUserOnly', setLogVisibility),
        vscode.commands.registerCommand('salesforce-log-viewer.deleteAllLogs', deleteAllLogs),
        vscode.commands.registerCommand('salesforce-log-viewer.toggleAutoRefresh', toggleAutoRefresh),
        vscode.commands.registerCommand('salesforce-log-viewer.showOptions', showOptions),
            vscode.commands.registerCommand('salesforce-log-viewer.showSearchBox', showSearchBox),
            vscode.commands.registerCommand('salesforce-log-viewer.clearSearch', clearSearch)
        );

        // Listen for org changes
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(async (e) => {
                if (e.affectsConfiguration('salesforce.sfdx-cli.defaultusername')) {
                    const newUsername = vscode.workspace.getConfiguration('salesforce.sfdx-cli').get('defaultusername');
                    if (newUsername !== currentOrgUsername) {
                        currentOrgUsername = newUsername as string;
                        await refreshConnection();
                        provider.updateView();
                    }
                }
            })
        );

        // Subscribe to data changes
        logProvider.onDidChangeData(({ data, isAutoRefresh }) => {
            console.log('Data changed event triggered');
            provider.updateView(data, isAutoRefresh);
        });

    } catch (error: any) {
        const errorMessage = error?.message || 'Unknown error occurred';
        console.error('Activation error:', error);
        vscode.window.showErrorMessage(`Failed to initialize Salesforce Log Viewer: ${errorMessage}`);
    }
}

class LogViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _logDataProvider: LogDataProvider
    ) {
        // Subscribe to data changes
        this._logDataProvider.onDidChangeData(({ data, isAutoRefresh }) => {
            this.updateView(data, isAutoRefresh);
        });
    }

    private postMessageToWebview(message: any) {
        if (this._view) {
            this._view.webview.postMessage(message);
        }
    }

    public updateView(data?: any[], isAutoRefresh: boolean = false) {
        const gridData = data || this._logDataProvider.getGridData();
        this.postMessageToWebview({ 
            type: 'updateData',
            data: gridData,
            isAutoRefresh: isAutoRefresh
        });
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview();

        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'ready':
                    // Send initial data
                    const initialData = this._logDataProvider.getGridData();
                    this.updateView(initialData, false);
                    break;
                case 'openLog':
                    await openLog({ id: message.log.id });
                    break;
            }
        });
    }

    private _getHtmlForWebview() {
        const columns = this._logDataProvider.columns;
        const templatePath = path.join(this._extensionUri.fsPath, 'src', 'templates', 'logViewer.html');
        let template = fs.readFileSync(templatePath, 'utf8');

        // Replace the column headers placeholder
        const columnHeaders = columns.map(col => 
            `<div class="grid-cell" data-field="${col.field}" style="width: ${col.width}px">${col.label}</div>`
        ).join('');
        template = template.replace('<!--COLUMN_HEADERS-->', columnHeaders);

        // Replace the column cells placeholder
        const columnCells = columns.map(col => `
            const ${col.field}Cell = document.createElement('div');
            ${col.field}Cell.className = 'grid-cell';
            ${col.field}Cell.dataset.field = '${col.field}';
            ${col.field}Cell.style.width = '${col.width}px';
            ${col.field}Cell.textContent = row.${col.field} || '';
            rowDiv.appendChild(${col.field}Cell);
        `).join('');
        template = template.replace('<!--COLUMN_CELLS-->', columnCells);

        return template;
    }
}

export function deactivate() {
    if (logDataProvider) {
        logDataProvider.dispose();
        logDataProvider = undefined;
    }
}

async function refreshConnection() {
    if (logDataProvider) {
        logDataProvider.dispose();
        logDataProvider = undefined;
    }
    await refreshLogs();
}

async function getLogDataProvider(): Promise<LogDataProvider> {
    if (!logDataProvider) {
        const config = vscode.workspace.getConfiguration('salesforceLogViewer');
        const connection = await createConnection();
        
        logDataProvider = new LogDataProvider(
            extensionContext,
            connection,
            {
                autoRefresh: config.get('autoRefresh') ?? true,
                refreshInterval: config.get('refreshInterval') ?? 5000,
                currentUserOnly: config.get('currentUserOnly') ?? true
            }
        );
    }
    return logDataProvider;
}

async function createConnection(): Promise<Connection> {
    try {
        // Get the Salesforce extension's configuration
        const sfConfig = vscode.workspace.getConfiguration('salesforcedx-vscode-core');
        
        // Try to get the connection info from the workspace state
        const workspaceState = extensionContext.workspaceState;
        const connectionInfo = workspaceState.get('sfdx:connection_info');

        if (!connectionInfo) {
            // If no connection info in workspace state, try to get it from the SFDX CLI
            const { exec } = require('child_process');
            const execPromise = (cmd: string) => new Promise<string>((resolve, reject) => {
                exec(cmd, (error: Error | null, stdout: string) => {
                    if (error) reject(error);
                    else resolve(stdout);
                });
            });

            // Get the default org username from VS Code settings
            const defaultUsername = sfConfig.get('defaultUsernameOrAlias') || 'DevOrg';
            
            try {
                // Get org details using SFDX
                const orgDetailsStr = await execPromise(`sfdx org:display -u "${defaultUsername}" --json`);
                const orgDetails = JSON.parse(orgDetailsStr);

                if (!orgDetails.result || !orgDetails.result.accessToken || !orgDetails.result.instanceUrl) {
                    throw new Error(`Unable to get connection details for org "${defaultUsername}". Please ensure you are authenticated.`);
                }

                // Store the connection info in workspace state for future use
                const connInfo = {
                    instanceUrl: orgDetails.result.instanceUrl,
                    accessToken: orgDetails.result.accessToken
                };
                
                await workspaceState.update('sfdx:connection_info', connInfo);
                return new Connection(connInfo);
            } catch (cmdError: any) {
                throw new Error(`Failed to get org details: ${cmdError.message}`);
            }
        }

        // Use the stored connection info
        return new Connection(connectionInfo);
    } catch (error: any) {
        const errorMessage = error?.message || 'Unknown error occurred';
        vscode.window.showErrorMessage(`Failed to connect to Salesforce: ${errorMessage}`);
        throw error;
    }
}

async function refreshLogs() {
    try {
        const provider = await getLogDataProvider();
        await provider.refreshLogs(false, true);
        vscode.window.showInformationMessage('Logs refreshed successfully');
    } catch (error: any) {
        const errorMessage = error?.message || 'Unknown error occurred';
        vscode.window.showErrorMessage(`Failed to refresh logs: ${errorMessage}`);
    }
}

async function openLog(data: { id: string }) {
    try {
        const provider = await getLogDataProvider();
        // Query the full log details with type assertion
        const result = await provider.connection.tooling.retrieve('ApexLog', data.id) as any;
        if (!result) {
            throw new Error(`Log with ID ${data.id} not found`);
        }

        // Create a DeveloperLog instance with the retrieved data
        const log = new DeveloperLog({
            Id: result.Id,
            LogUser: { Name: result.LogUser?.Name || 'Unknown' },
            Operation: result.Operation || '',
            StartTime: result.StartTime || new Date().toISOString(),
            Status: result.Status || '',
            LogLength: result.LogLength || 0,
            DurationMilliseconds: result.DurationMilliseconds || 0,
            Application: result.Application || '',
            Location: result.Location || '',
            Request: result.Request || ''
        }, provider.connection);

        await provider.logViewer.showLog(log);
    } catch (error: any) {
        const errorMessage = error?.message || 'Unknown error occurred';
        vscode.window.showErrorMessage(`Failed to open log: ${errorMessage}`);
    }
}

async function setLogVisibility() {
    const provider = await getLogDataProvider();
    const currentSetting = provider.getCurrentUserOnlySetting();

    const items: vscode.QuickPickItem[] = [
        {
            label: `${currentSetting ? '✓' : '  '} Current user only`,
            description: "Display only the Salesforce developer logs for the currently connected user",
            picked: currentSetting
        },
        {
            label: `${!currentSetting ? '✓' : '  '} All users`,
            description: "Display Salesforce developer logs from all users with active trace flags on the target org",
            picked: !currentSetting
        }
    ];

    const selection = await vscode.window.showQuickPick(items, {
        placeHolder: "Select log visibility setting"
    });

    if (!selection) {
        return; // User cancelled
    }

    const wantsCurrentUserOnly = selection.label.includes("Current user only");

    // Only call the update method if the selection is different from the current setting
    if (wantsCurrentUserOnly !== currentSetting) {
        try {
            await provider.setCurrentUserOnly(wantsCurrentUserOnly);
            const status = wantsCurrentUserOnly ? 'Current User Only' : 'All Users';
            vscode.window.showInformationMessage(`Log visibility set to: ${status}`);
        } catch (error: any) {
            const errorMessage = error?.message || 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to set log visibility: ${errorMessage}`);
        }
    }
}

async function deleteAllLogs() {
    const confirmation = await vscode.window.showWarningMessage(
        'Are you sure you want to delete ALL Apex logs from your Salesforce org? This action cannot be undone.',
        { modal: true }, // Make it a modal dialog
        'Delete All Logs'
    );

    if (confirmation !== 'Delete All Logs') {
        vscode.window.showInformationMessage('Delete logs operation cancelled.');
        return;
    }

    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Deleting Salesforce logs...",
        cancellable: false
    }, async (progress) => {
        try {
            const provider = await getLogDataProvider();
            const connection = provider.connection; // Access connection via provider

            progress.report({ message: "Querying log IDs..." });
            const result = await connection.tooling.query<{ Id: string }>('SELECT Id FROM ApexLog');
            
            if (!result.records || result.records.length === 0) {
                vscode.window.showInformationMessage('No logs found to delete.');
                return;
            }

            const logIds = result.records.map(record => record.Id);
            const totalLogs = logIds.length;
            progress.report({ message: `Found ${totalLogs} logs. Deleting...` });

            // Salesforce Tooling API delete limit is 200 records per call
            const chunkSize = 200;
            for (let i = 0; i < logIds.length; i += chunkSize) {
                const chunk = logIds.slice(i, i + chunkSize);
                progress.report({ 
                    message: `Deleting logs ${i + 1}-${Math.min(i + chunkSize, totalLogs)} of ${totalLogs}...`, 
                    increment: (chunk.length / totalLogs) * 100 
                });
                await connection.tooling.destroy('ApexLog', chunk);
            }

            vscode.window.showInformationMessage(`Successfully deleted ${totalLogs} logs.`);
            await provider.refreshLogs(); // Refresh the view
        } catch (error: any) {
            const errorMessage = error?.message || 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to delete logs: ${errorMessage}`);
        }
    });
}

async function toggleAutoRefresh() {
    const provider = await getLogDataProvider();
    const currentSetting = provider.getAutoRefreshSetting();

    const items: vscode.QuickPickItem[] = [
        {
            label: `${currentSetting ? '✓' : '  '} Auto-refresh enabled`,
            description: "Automatically refresh logs at the configured interval",
            picked: currentSetting
        },
        {
            label: `${!currentSetting ? '✓' : '  '} Auto-refresh disabled`,
            description: "Manually refresh logs using the refresh button",
            picked: !currentSetting
        }
    ];

    const selection = await vscode.window.showQuickPick(items, {
        placeHolder: "Select auto-refresh setting"
    });

    if (!selection) {
        return; // User cancelled
    }

    const wantsAutoRefresh = selection.label.includes("enabled");

    // Only call the update method if the selection is different from the current setting
    if (wantsAutoRefresh !== currentSetting) {
        try {
            await provider.setAutoRefresh(wantsAutoRefresh);
            const status = wantsAutoRefresh ? 'Enabled' : 'Disabled';
            vscode.window.showInformationMessage(`Auto-refresh ${status}`);
        } catch (error: any) {
            const errorMessage = error?.message || 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to set auto-refresh: ${errorMessage}`);
        }
    }
}

async function showOptions() {
    const provider = await getLogDataProvider();
    const currentAutoRefresh = provider.getAutoRefreshSetting();
    const config = vscode.workspace.getConfiguration('salesforceLogViewer');

    const items: vscode.QuickPickItem[] = [
        {
            label: "Auto-refresh",
            description: currentAutoRefresh ? "✓ Enabled" : "✗ Disabled",
            detail: "Automatically refresh logs at the configured interval",
            picked: currentAutoRefresh
        },
        {
            label: "Refresh Interval",
            description: `${config.get('refreshInterval')}ms`,
            detail: "Set the interval between automatic refreshes"
        }
    ];

    const selection = await vscode.window.showQuickPick(items, {
        placeHolder: "Select an option to configure"
    });

    if (!selection) {
        return;
    }

    switch (selection.label) {
        case "Auto-refresh":
            await toggleAutoRefresh();
            break;
        case "Refresh Interval":
            const interval = await vscode.window.showInputBox({
                prompt: "Enter refresh interval in milliseconds",
                value: config.get('refreshInterval')?.toString(),
                validateInput: (value) => {
                    const num = parseInt(value);
                    if (isNaN(num) || num < 1000) {
                        return "Please enter a valid number greater than 1000";
                    }
                    return null;
                }
            });
            if (interval) {
                await config.update('refreshInterval', parseInt(interval), vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(`Refresh interval set to ${interval}ms`);
            }
            break;
    }
}

async function showSearchBox() {
    try {
        const provider = await getLogDataProvider();
        const currentFilter = provider.getSearchFilter();
        
        const searchText = await vscode.window.showInputBox({
            placeHolder: 'Filter logs by operation or username...',
            prompt: 'Enter text to filter logs',
            value: currentFilter,
            ignoreFocusOut: true
        });
        
        if (searchText !== undefined) {
            provider.setSearchFilter(searchText);
        }
    } catch (error: any) {
        const errorMessage = error?.message || 'Unknown error occurred';
        vscode.window.showErrorMessage(`Failed to filter logs: ${errorMessage}`);
    }
}

async function clearSearch() {
    try {
        const provider = await getLogDataProvider();
        provider.clearSearch();
        vscode.window.showInformationMessage('Search filter cleared');
    } catch (error: any) {
        const errorMessage = error?.message || 'Unknown error occurred';
        vscode.window.showErrorMessage(`Failed to clear search: ${errorMessage}`);
    }
}