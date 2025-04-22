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
let logDataProvider;
let extensionContext;
async function activate(context) {
    extensionContext = context;
    const config = vscode.workspace.getConfiguration('salesforceLogViewer');
    // Register commands
    context.subscriptions.push(vscode.commands.registerCommand('salesforce-log-viewer.refreshLogs', refreshLogs), vscode.commands.registerCommand('salesforce-log-viewer.openLog', openLog), vscode.commands.registerCommand('salesforce-log-viewer.toggleCurrentUserOnly', setLogVisibility), vscode.commands.registerCommand('salesforce-log-viewer.deleteAllLogs', deleteAllLogs), vscode.commands.registerCommand('salesforce-log-viewer.toggleAutoRefresh', toggleAutoRefresh), vscode.commands.registerCommand('salesforce-log-viewer.showOptions', showOptions), vscode.commands.registerCommand('salesforce-log-viewer.showSearchBox', showSearchBox));
    try {
        // Create tree view
        const treeView = vscode.window.createTreeView('salesforceLogsView', {
            treeDataProvider: await getLogDataProvider(),
            showCollapseAll: true
        });
        context.subscriptions.push(treeView);
        // Reveal the Salesforce Logs view in the activity bar
        const provider = await getLogDataProvider();
        const children = await provider.getChildren();
        if (children && children.length > 0) {
            try {
                await treeView.reveal(children[0], { focus: true, expand: false });
            }
            catch (revealError) {
                // If reveal fails, just log it and continue
                console.log('Failed to reveal tree view item:', revealError);
            }
        }
    }
    catch (error) {
        const errorMessage = error?.message || 'Unknown error occurred';
        vscode.window.showErrorMessage(`Failed to initialize Salesforce Log Viewer: ${errorMessage}`);
    }
}
exports.activate = activate;
function deactivate() {
    if (logDataProvider) {
        logDataProvider.dispose();
        logDataProvider = undefined;
    }
}
exports.deactivate = deactivate;
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
        // Get org list from SFDX
        const { stdout: orgListOutput } = await executeCommand('sfdx force:org:list --json');
        const orgList = JSON.parse(orgListOutput);
        if (!orgList.result || !orgList.result.nonScratchOrgs || orgList.result.nonScratchOrgs.length === 0) {
            throw new Error('No connected orgs found. Please authenticate with SFDX first using: sfdx force:auth:web:login');
        }
        // Use the first connected org
        const org = orgList.result.nonScratchOrgs[0];
        // Get org details
        const { stdout: orgDetailsOutput } = await executeCommand(`sfdx force:org:display --json -u ${org.username}`);
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
async function openLog(log) {
    try {
        const provider = await getLogDataProvider();
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
    // Update the command title to reflect current state
    await vscode.commands.executeCommand('setContext', 'salesforceLogViewer.autoRefreshEnabled', currentSetting);
    const items = [
        {
            label: "Auto-refresh enabled",
            description: "Automatically refresh logs at the configured interval",
            picked: currentSetting
        },
        {
            label: "Auto-refresh disabled",
            description: "Manually refresh logs using the refresh button",
            picked: !currentSetting
        }
    ];
    const selection = await vscode.window.showQuickPick(items, {
        placeHolder: `Auto-refresh is currently ${currentSetting ? 'enabled' : 'disabled'}. Select new state:`
    });
    if (!selection) {
        return;
    }
    const wantsAutoRefresh = selection.label === "Auto-refresh enabled";
    if (wantsAutoRefresh !== currentSetting) {
        try {
            await provider.setAutoRefresh(wantsAutoRefresh);
            const status = wantsAutoRefresh ? 'enabled' : 'disabled';
            vscode.window.showInformationMessage(`Auto-refresh ${status}`);
            // Update the command title after changing the state
            await vscode.commands.executeCommand('setContext', 'salesforceLogViewer.autoRefreshEnabled', wantsAutoRefresh);
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
        const searchText = await vscode.window.showInputBox({
            placeHolder: 'Filter logs by operation or username...',
            prompt: 'Enter text to filter logs'
        });
        if (searchText !== undefined) { // User didn't cancel
            provider.setSearchFilter(searchText);
        }
    }
    catch (error) {
        const errorMessage = error?.message || 'Unknown error occurred';
        vscode.window.showErrorMessage(`Failed to filter logs: ${errorMessage}`);
    }
}
//# sourceMappingURL=extension.js.map