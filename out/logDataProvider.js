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
exports.LogDataProvider = void 0;
const vscode = __importStar(require("vscode"));
const developerLog_1 = require("./developerLog");
const logViewer_1 = require("./logViewer");
class LogDataProvider {
    constructor(context, connection, config) {
        this.connection = connection;
        this.config = config;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.logs = [];
        this.filteredLogs = [];
        this.searchText = '';
        this.autoRefreshPaused = true;
        this.isRefreshing = false;
        this.isCollapsed = false;
        // Define widths at class level for access in multiple methods
        this.userWidth = 20;
        this.timeWidth = 10;
        this.statusWidth = 10;
        this.sizeWidth = 8;
        this.targetDataOperationLength = 50; // For data rows
        this.context = context;
        this.logViewer = new logViewer_1.LogViewer(vscode.workspace.rootPath);
        this.logs = [];
        this.filteredLogs = [];
        this.initialize();
    }
    async initialize() {
        try {
            if (this.config.currentUserOnly) {
                this.currentUserId = await this.getCurrentUserId();
            }
            // Initial load of logs
            await this.refreshLogs(true);
            // Start auto-refresh if configured
            if (this.config.autoRefresh) {
                this.startAutoRefresh();
            }
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to initialize log viewer: ${error.message}`);
            console.error('Initialization error:', error);
        }
    }
    dispose() {
        this.stopAutoRefresh();
    }
    startAutoRefresh() {
        this.autoRefreshPaused = false;
        this.scheduleRefresh();
    }
    stopAutoRefresh() {
        this.autoRefreshPaused = true;
        if (this.autoRefreshScheduledId) {
            clearTimeout(this.autoRefreshScheduledId);
            this.autoRefreshScheduledId = undefined;
        }
    }
    scheduleRefresh() {
        if (this.autoRefreshScheduledId) {
            clearTimeout(this.autoRefreshScheduledId);
        }
        if (!this.autoRefreshPaused && !this.isRefreshing) {
            this.autoRefreshScheduledId = setTimeout(() => this.refreshLogs(false, false), this.config.refreshInterval);
        }
    }
    async refreshLogs(isInitialLoad = false, isManualRefresh = false) {
        if (this.isRefreshing) {
            return;
        }
        this.isRefreshing = true;
        try {
            const refreshDate = new Date();
            let query = 'SELECT Id, Application, DurationMilliseconds, LogLength, LogUser.Name, Operation, Request, StartTime, Status FROM ApexLog';
            let hasWhereClause = false;
            if (this.config.currentUserOnly && this.currentUserId) {
                query += ` WHERE LogUserId = '${this.currentUserId}'`;
                hasWhereClause = true;
            }
            query += ' ORDER BY StartTime DESC LIMIT 100';
            const result = await this.connection.tooling.query(query);
            this.lastRefresh = refreshDate;
            let updatedLogs = [];
            if (result.records && result.records.length > 0) {
                const newLogs = result.records.map(record => new developerLog_1.DeveloperLog(record, this.connection));
                if (isInitialLoad) {
                    updatedLogs = newLogs;
                }
                else {
                    const uniqueLogEntries = new Map();
                    newLogs.forEach(log => uniqueLogEntries.set(log.id, log));
                    this.logs.forEach(log => {
                        if (!uniqueLogEntries.has(log.id)) {
                            uniqueLogEntries.set(log.id, log);
                        }
                    });
                    updatedLogs = Array.from(uniqueLogEntries.values());
                }
            }
            else {
                updatedLogs = [];
            }
            this.logs = updatedLogs
                .filter(log => log.operation !== '<empty>')
                .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
                .slice(0, 100);
            // Clear search filter on initial load or manual refresh
            if (isInitialLoad || isManualRefresh) {
                this.searchText = '';
                this.filteredLogs = [...this.logs];
            }
            else {
                // Re-apply existing filter for auto-refresh
                this._filterLogs();
            }
            this._onDidChangeTreeData.fire(undefined);
        }
        catch (error) {
            vscode.window.showErrorMessage(`Failed to refresh logs: ${error.message}`);
            console.error('Refresh error:', error);
        }
        finally {
            this.isRefreshing = false;
            this.scheduleRefresh();
        }
    }
    async getCurrentUserId() {
        const result = await this.connection.identity();
        return result.user_id;
    }
    async setCurrentUserOnly(showCurrentUserOnly) {
        if (this.config.currentUserOnly === showCurrentUserOnly) {
            return;
        }
        this.config.currentUserOnly = showCurrentUserOnly;
        const config = vscode.workspace.getConfiguration('salesforceLogViewer');
        await config.update('currentUserOnly', this.config.currentUserOnly, vscode.ConfigurationTarget.Global);
        if (this.config.currentUserOnly && !this.currentUserId) {
            try {
                this.currentUserId = await this.getCurrentUserId();
            }
            catch (error) {
                vscode.window.showErrorMessage(`Failed to get current user ID: ${error.message}. Showing all users.`);
                this.config.currentUserOnly = false;
                await config.update('currentUserOnly', this.config.currentUserOnly, vscode.ConfigurationTarget.Global);
            }
        }
        await this.refreshLogs(true);
        this._onDidChangeTreeData.fire(undefined);
    }
    getCurrentUserOnlySetting() {
        return vscode.workspace.getConfiguration('salesforceLogViewer').get('currentUserOnly') ?? true;
    }
    async setAutoRefresh(enabled) {
        if (this.config.autoRefresh === enabled) {
            return;
        }
        this.config.autoRefresh = enabled;
        const config = vscode.workspace.getConfiguration('salesforceLogViewer');
        await config.update('autoRefresh', this.config.autoRefresh, vscode.ConfigurationTarget.Global);
        if (enabled) {
            this.startAutoRefresh();
        }
        else {
            this.stopAutoRefresh();
        }
    }
    getAutoRefreshSetting() {
        return this.config.autoRefresh;
    }
    // --- TreeDataProvider Implementation ---
    getTreeItem(log) {
        const isHeader = log.id === 'header';
        const label = this.getLabel(log);
        const treeItem = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        treeItem.description = this.getDescription(log);
        if (!isHeader) {
            treeItem.tooltip = this.getTooltip(log);
            treeItem.command = {
                command: 'salesforce-log-viewer.openLog',
                title: 'Open Log',
                arguments: [log]
            };
            treeItem.iconPath = {
                light: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'light', 'log.svg'),
                dark: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'dark', 'log.svg')
            };
        }
        return treeItem;
    }
    getChildren(element) {
        if (!element) {
            const filterStatus = this.config.currentUserOnly ? '(Current User Only)' : '(All Users)';
            const headerLog = new developerLog_1.DeveloperLog({
                Id: 'header', LogUser: { Name: 'USER' }, Operation: 'OPERATION',
                StartTime: new Date().toISOString(), Status: 'STATUS', LogLength: 0,
                DurationMilliseconds: 0, Location: '', Application: '', Request: ''
            }, this.connection);
            return [headerLog, ...this.filteredLogs];
        }
        return [];
    }
    getParent(element) {
        return null;
    }
    // --- Formatting Helpers ---
    getLabel(log) {
        if (log.id === 'header') {
            const userHeader = 'USER'.padEnd(this.userWidth);
            return userHeader;
        }
        // Handle data rows
        const paddedUser = log.user.padEnd(this.userWidth);
        return paddedUser;
    }
    getDescription(log) {
        if (log.id === 'header') {
            const timeHeader = 'TIME'.padEnd(this.timeWidth);
            const statusHeader = 'STATUS'.padEnd(this.statusWidth);
            const sizeHeader = 'SIZE'.padEnd(this.sizeWidth);
            const operationHeader = 'OPERATION';
            return `${timeHeader}     ${statusHeader}     ${sizeHeader}     ${operationHeader}`;
        }
        // Handle data rows
        const time = new Date(log.startTime).toLocaleTimeString('en-US', {
            hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
        const size = `${(log.size / 1024).toFixed(1)}KB`;
        const paddedTime = time.padEnd(this.timeWidth);
        const paddedStatus = log.status.padEnd(this.statusWidth);
        const paddedSize = size.padEnd(this.sizeWidth);
        let formattedOperation = log.operation;
        if (log.operation.length > this.targetDataOperationLength) {
            formattedOperation = log.operation.substring(0, this.targetDataOperationLength - 3) + '...';
        }
        return `${paddedTime}    ${paddedStatus}    ${paddedSize}    ${formattedOperation}`;
    }
    getTooltip(log) {
        if (log.id === 'header')
            return '';
        const time = new Date(log.startTime).toLocaleString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        return [
            `User: ${log.user}`,
            `Operation: ${log.operation}`,
            `Time: ${time}`,
            `Duration: ${log.durationMilliseconds}ms`,
            `Application: ${log.application}`,
            `Request: ${log.request}`
        ].join('\n');
    }
    async searchLogs(searchText) {
        const searchLower = searchText.toLowerCase();
        return this.logs.filter(log => log.operation.toLowerCase().includes(searchLower) ||
            log.user.toLowerCase().includes(searchLower));
    }
    setSearchFilter(text) {
        this.searchText = text;
        this._filterLogs();
        this._onDidChangeTreeData.fire(undefined);
    }
    _filterLogs() {
        if (!this.searchText) {
            this.filteredLogs = [...this.logs];
            return;
        }
        const searchLower = this.searchText.toLowerCase();
        this.filteredLogs = this.logs.filter(log => log.operation.toLowerCase().includes(searchLower) ||
            log.user.toLowerCase().includes(searchLower));
    }
}
exports.LogDataProvider = LogDataProvider;
//# sourceMappingURL=logDataProvider.js.map