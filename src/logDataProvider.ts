import * as vscode from 'vscode';
import { Connection } from 'jsforce';
import { DeveloperLog, DeveloperLogRecord } from './developerLog';
import { LogViewer } from './logViewer';

export class LogDataProvider implements vscode.TreeDataProvider<DeveloperLog>, vscode.Disposable {
    private _onDidChangeTreeData: vscode.EventEmitter<DeveloperLog | undefined> = new vscode.EventEmitter<DeveloperLog | undefined>();
    readonly onDidChangeTreeData: vscode.Event<DeveloperLog | undefined> = this._onDidChangeTreeData.event;

    private logs: DeveloperLog[] = [];
    private filteredLogs: DeveloperLog[] = [];
    private searchText: string = '';
    private lastRefresh?: Date;
    private autoRefreshScheduledId?: NodeJS.Timeout;
    private autoRefreshPaused: boolean = true;
    private isRefreshing: boolean = false;
    private currentUserId?: string;
    public readonly logViewer: LogViewer;
    private context: vscode.ExtensionContext;
    private isCollapsed: boolean = false;

    // Define widths at class level for access in multiple methods
    private readonly userWidth = 20;
    private readonly timeWidth = 10;
    private readonly statusWidth = 10;
    private readonly sizeWidth = 8;
    private readonly targetDataOperationLength = 50; // For data rows

    constructor(
        context: vscode.ExtensionContext,
        public readonly connection: Connection,
        private readonly config: {
            autoRefresh: boolean;
            refreshInterval: number;
            currentUserOnly: boolean;
        }
    ) {
        this.context = context;
        this.logViewer = new LogViewer(vscode.workspace.rootPath);
        this.logs = [];
        this.filteredLogs = [];
        this.initialize();
    }

    private async initialize() {
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
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to initialize log viewer: ${error.message}`);
            console.error('Initialization error:', error);
        }
    }

    dispose() {
        this.stopAutoRefresh();
    }

    private startAutoRefresh() {
        this.autoRefreshPaused = false;
        this.scheduleRefresh();
    }

    private stopAutoRefresh() {
        this.autoRefreshPaused = true;
        if (this.autoRefreshScheduledId) {
            clearTimeout(this.autoRefreshScheduledId);
            this.autoRefreshScheduledId = undefined;
        }
    }

    private scheduleRefresh() {
        if (this.autoRefreshScheduledId) {
            clearTimeout(this.autoRefreshScheduledId);
        }
        if (!this.autoRefreshPaused && !this.isRefreshing) {
            this.autoRefreshScheduledId = setTimeout(() => this.refreshLogs(false, false), this.config.refreshInterval);
        }
    }

    public async refreshLogs(isInitialLoad: boolean = false, isManualRefresh: boolean = false): Promise<void> {
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

            const result = await this.connection.tooling.query<DeveloperLogRecord>(query);
            this.lastRefresh = refreshDate; 

            let updatedLogs: DeveloperLog[] = [];
            if (result.records && result.records.length > 0) {
                const newLogs = result.records.map(record => new DeveloperLog(record, this.connection));
                
                if (isInitialLoad) {
                    updatedLogs = newLogs;
                } else {
                    const uniqueLogEntries = new Map<string, DeveloperLog>();
                    newLogs.forEach(log => uniqueLogEntries.set(log.id, log)); 
                    this.logs.forEach(log => {
                        if (!uniqueLogEntries.has(log.id)) {
                            uniqueLogEntries.set(log.id, log);
                        }
                    });
                    updatedLogs = Array.from(uniqueLogEntries.values());
                }
            } else {
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
            } else {
                // Re-apply existing filter for auto-refresh
                this._filterLogs();
            }

            this._onDidChangeTreeData.fire(undefined);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to refresh logs: ${error.message}`);
            console.error('Refresh error:', error);
        } finally {
            this.isRefreshing = false;
            this.scheduleRefresh(); 
        }
    }
    
    private async getCurrentUserId(): Promise<string> {
        const result = await this.connection.identity();
        return result.user_id;
    }

    public async setCurrentUserOnly(showCurrentUserOnly: boolean): Promise<void> {
        if (this.config.currentUserOnly === showCurrentUserOnly) {
            return; 
        }
        this.config.currentUserOnly = showCurrentUserOnly;
        const config = vscode.workspace.getConfiguration('salesforceLogViewer');
        await config.update('currentUserOnly', this.config.currentUserOnly, vscode.ConfigurationTarget.Global);
        
        if (this.config.currentUserOnly && !this.currentUserId) {
            try {
                 this.currentUserId = await this.getCurrentUserId();
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to get current user ID: ${error.message}. Showing all users.`);
                this.config.currentUserOnly = false; 
                await config.update('currentUserOnly', this.config.currentUserOnly, vscode.ConfigurationTarget.Global);
            }
        }
        await this.refreshLogs(true); 
        this._onDidChangeTreeData.fire(undefined);
    }

    public getCurrentUserOnlySetting(): boolean {
        return vscode.workspace.getConfiguration('salesforceLogViewer').get('currentUserOnly') ?? true;
    }

    public async setAutoRefresh(enabled: boolean): Promise<void> {
        if (this.config.autoRefresh === enabled) {
            return;
        }
        this.config.autoRefresh = enabled;
        const config = vscode.workspace.getConfiguration('salesforceLogViewer');
        await config.update('autoRefresh', this.config.autoRefresh, vscode.ConfigurationTarget.Global);
        
        if (enabled) {
            this.startAutoRefresh();
        } else {
            this.stopAutoRefresh();
        }
    }

    public getAutoRefreshSetting(): boolean {
        return this.config.autoRefresh;
    }

    // --- TreeDataProvider Implementation ---

    public getTreeItem(log: DeveloperLog): vscode.TreeItem {
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

    public getChildren(element?: DeveloperLog): vscode.ProviderResult<DeveloperLog[]> {
        if (!element) {
            const filterStatus = this.config.currentUserOnly ? '(Current User Only)' : '(All Users)';
            const headerLog = new DeveloperLog({
                Id: 'header', LogUser: { Name: 'USER' }, Operation: 'OPERATION',
                StartTime: new Date().toISOString(), Status: 'STATUS', LogLength: 0,
                DurationMilliseconds: 0, Location: '', Application: '', Request: ''
            }, this.connection);
            return [headerLog, ...this.filteredLogs];
        }
        return [];
    }

    public getParent(element: DeveloperLog): vscode.ProviderResult<DeveloperLog> {
        return null;
    }

    // --- Formatting Helpers ---

    private getLabel(log: DeveloperLog): string {
        if (log.id === 'header') {
            const userHeader = 'USER'.padEnd(this.userWidth);
            return userHeader;
        }
        
        // Handle data rows
        const paddedUser = log.user.padEnd(this.userWidth);
        return paddedUser;
    }

    private getDescription(log: DeveloperLog): string | undefined {
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

    private getTooltip(log: DeveloperLog): string {
        if (log.id === 'header') return '';
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

    public async searchLogs(searchText: string): Promise<DeveloperLog[]> {
        const searchLower = searchText.toLowerCase();
        return this.logs.filter(log => 
            log.operation.toLowerCase().includes(searchLower) ||
            log.user.toLowerCase().includes(searchLower)
        );
    }

    public setSearchFilter(text: string) {
        this.searchText = text;
        this._filterLogs();
        this._onDidChangeTreeData.fire(undefined);
    }

    private _filterLogs() {
        if (!this.searchText) {
            this.filteredLogs = [...this.logs];
            return;
        }
        const searchLower = this.searchText.toLowerCase();
        this.filteredLogs = this.logs.filter(log => 
            log.operation.toLowerCase().includes(searchLower) ||
            log.user.toLowerCase().includes(searchLower)
        );
    }
}