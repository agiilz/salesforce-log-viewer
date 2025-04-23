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
exports.deactivate = exports.activate = void 0;
const vscode = __importStar(require("vscode"));
const jsforce_1 = require("jsforce");
const logDataProvider_1 = require("./logDataProvider");
const developerLog_1 = require("./developerLog");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
let logDataProvider;
let extensionContext;
let currentOrgUsername;
async function activate(context) {
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
        context.subscriptions.push(vscode.window.registerWebviewViewProvider('salesforceLogsView', provider));
        // Register commands
        context.subscriptions.push(vscode.commands.registerCommand('salesforce-log-viewer.refreshLogs', async () => {
            console.log('Refresh command triggered');
            await refreshLogs();
            provider.updateView();
        }), vscode.commands.registerCommand('salesforce-log-viewer.openLog', openLog), vscode.commands.registerCommand('salesforce-log-viewer.toggleCurrentUserOnly', setLogVisibility), vscode.commands.registerCommand('salesforce-log-viewer.deleteAllLogs', deleteAllLogs), vscode.commands.registerCommand('salesforce-log-viewer.toggleAutoRefresh', toggleAutoRefresh), vscode.commands.registerCommand('salesforce-log-viewer.showOptions', showOptions), vscode.commands.registerCommand('salesforce-log-viewer.showSearchBox', showSearchBox), vscode.commands.registerCommand('salesforce-log-viewer.clearSearch', clearSearch));
        // Listen for org changes
        context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration('salesforce.sfdx-cli.defaultusername')) {
                const newUsername = vscode.workspace.getConfiguration('salesforce.sfdx-cli').get('defaultusername');
                if (newUsername !== currentOrgUsername) {
                    currentOrgUsername = newUsername;
                    await refreshConnection();
                    provider.updateView();
                }
            }
        }));
        // Subscribe to data changes
        logProvider.onDidChangeData(({ data, isAutoRefresh }) => {
            console.log('Data changed event triggered');
            provider.updateView(data, isAutoRefresh);
        });
    }
    catch (error) {
        const errorMessage = error?.message || 'Unknown error occurred';
        console.error('Activation error:', error);
        vscode.window.showErrorMessage(`Failed to initialize Salesforce Log Viewer: ${errorMessage}`);
    }
}
exports.activate = activate;
class LogViewProvider {
    constructor(_extensionUri, _logDataProvider) {
        this._extensionUri = _extensionUri;
        this._logDataProvider = _logDataProvider;
        // Subscribe to data changes
        this._logDataProvider.onDidChangeData(({ data, isAutoRefresh }) => {
            this.updateView(data, isAutoRefresh);
        });
    }
    postMessageToWebview(message) {
        if (this._view) {
            this._view.webview.postMessage(message);
        }
    }
    updateView(data, isAutoRefresh = false) {
        const gridData = data || this._logDataProvider.getGridData();
        this.postMessageToWebview({
            type: 'updateData',
            data: gridData,
            isAutoRefresh: isAutoRefresh
        });
    }
    resolveWebviewView(webviewView, context, _token) {
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
    _getHtmlForWebview() {
        const columns = this._logDataProvider.columns;
        const templatePath = path.join(this._extensionUri.fsPath, 'src', 'templates', 'logViewer.html');
        let template = fs.readFileSync(templatePath, 'utf8');
        // Replace the column headers placeholder
        const columnHeaders = columns.map(col => `<div class="grid-cell" data-field="${col.field}" style="width: ${col.width}px">${col.label}</div>`).join('');
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
function deactivate() {
    if (logDataProvider) {
        logDataProvider.dispose();
        logDataProvider = undefined;
    }
}
exports.deactivate = deactivate;
async function refreshConnection() {
    if (logDataProvider) {
        logDataProvider.dispose();
        logDataProvider = undefined;
    }
    await refreshLogs();
}
async function getLogDataProvider() {
    if (!logDataProvider) {
        const config = vscode.workspace.getConfiguration('salesforceLogViewer');
        const connection = await createConnection();
        logDataProvider = new logDataProvider_1.LogDataProvider(extensionContext, connection, {
            autoRefresh: config.get('autoRefresh') ?? true,
            refreshInterval: config.get('refreshInterval') ?? 5000,
            currentUserOnly: config.get('currentUserOnly') ?? true
        });
    }
    return logDataProvider;
}
async function createConnection() {
    try {
        // Try SF CLI first
        try {
            const { stdout: orgListOutputSF } = await executeCommand('sf org list --json');
            const orgListSF = JSON.parse(orgListOutputSF);
            if (orgListSF.result && orgListSF.result.length > 0) {
                const org = orgListSF.result.find((org) => org.isDefaultUsername) || orgListSF.result[0];
                const { stdout: orgDetailsOutputSF } = await executeCommand(`sf org display --json -o ${org.alias || org.username}`);
                const orgDetailsSF = JSON.parse(orgDetailsOutputSF);
                if (orgDetailsSF.result) {
                    return new jsforce_1.Connection({
                        instanceUrl: orgDetailsSF.result.instanceUrl,
                        accessToken: orgDetailsSF.result.accessToken
                    });
                }
            }
        }
        catch (sfError) {
            console.log('SF CLI attempt failed, trying SFDX...');
        }
        // Fallback to SFDX
        const { stdout: orgListOutput } = await executeCommand('sfdx force:org:list --json');
        const orgList = JSON.parse(orgListOutput);
        if (!orgList.result || (!orgList.result.nonScratchOrgs?.length && !orgList.result.scratchOrgs?.length)) {
            throw new Error('No connected orgs found. Please authenticate using either:\n\nsf org login web\n- or -\nsfdx force:auth:web:login');
        }
        // Try to find default org or use first available
        const nonScratchOrgs = orgList.result.nonScratchOrgs || [];
        const scratchOrgs = orgList.result.scratchOrgs || [];
        const allOrgs = [...nonScratchOrgs, ...scratchOrgs];
        const defaultOrg = allOrgs.find(org => org.isDefaultUsername) || allOrgs[0];
        // Get org details using SFDX
        const { stdout: orgDetailsOutput } = await executeCommand(`sfdx force:org:display --json -u ${defaultOrg.username}`);
        const orgDetails = JSON.parse(orgDetailsOutput);
        if (!orgDetails.result) {
            throw new Error('Failed to get org details. Please make sure you are connected to your org.');
        }
        return new jsforce_1.Connection({
            instanceUrl: orgDetails.result.instanceUrl,
            accessToken: orgDetails.result.accessToken
        });
    }
    catch (error) {
        const errorMessage = error?.message || 'Unknown error occurred';
        vscode.window.showErrorMessage(`Failed to connect to Salesforce: ${errorMessage}`);
        throw error;
    }
}
async function executeCommand(command) {
    const { exec } = require('child_process');
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(error);
            }
            else {
                resolve({ stdout, stderr });
            }
        });
    });
}
async function refreshLogs() {
    try {
        const provider = await getLogDataProvider();
        await provider.refreshLogs(false, true);
        vscode.window.showInformationMessage('Logs refreshed successfully');
    }
    catch (error) {
        const errorMessage = error?.message || 'Unknown error occurred';
        vscode.window.showErrorMessage(`Failed to refresh logs: ${errorMessage}`);
    }
}
async function openLog(data) {
    try {
        const provider = await getLogDataProvider();
        // Query the full log details with type assertion
        const result = await provider.connection.tooling.retrieve('ApexLog', data.id);
        if (!result) {
            throw new Error(`Log with ID ${data.id} not found`);
        }
        // Create a DeveloperLog instance with the retrieved data
        const log = new developerLog_1.DeveloperLog({
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
    }
    catch (error) {
        const errorMessage = error?.message || 'Unknown error occurred';
        vscode.window.showErrorMessage(`Failed to open log: ${errorMessage}`);
    }
}
async function setLogVisibility() {
    const provider = await getLogDataProvider();
    const currentSetting = provider.getCurrentUserOnlySetting();
    const items = [
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
        }
        catch (error) {
            const errorMessage = error?.message || 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to set log visibility: ${errorMessage}`);
        }
    }
}
async function deleteAllLogs() {
    const confirmation = await vscode.window.showWarningMessage('Are you sure you want to delete ALL Apex logs from your Salesforce org? This action cannot be undone.', { modal: true }, // Make it a modal dialog
    'Delete All Logs');
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
            const result = await connection.tooling.query('SELECT Id FROM ApexLog');
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
        }
        catch (error) {
            const errorMessage = error?.message || 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to delete logs: ${errorMessage}`);
        }
    });
}
async function toggleAutoRefresh() {
    const provider = await getLogDataProvider();
    const currentSetting = provider.getAutoRefreshSetting();
    const items = [
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
        }
        catch (error) {
            const errorMessage = error?.message || 'Unknown error occurred';
            vscode.window.showErrorMessage(`Failed to set auto-refresh: ${errorMessage}`);
        }
    }
}
async function showOptions() {
    const provider = await getLogDataProvider();
    const currentAutoRefresh = provider.getAutoRefreshSetting();
    const config = vscode.workspace.getConfiguration('salesforceLogViewer');
    const items = [
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
    }
    catch (error) {
        const errorMessage = error?.message || 'Unknown error occurred';
        vscode.window.showErrorMessage(`Failed to filter logs: ${errorMessage}`);
    }
}
async function clearSearch() {
    try {
        const provider = await getLogDataProvider();
        provider.clearSearch();
        vscode.window.showInformationMessage('Search filter cleared');
    }
    catch (error) {
        const errorMessage = error?.message || 'Unknown error occurred';
        vscode.window.showErrorMessage(`Failed to clear search: ${errorMessage}`);
    }
}
//# sourceMappingURL=extension.js.map