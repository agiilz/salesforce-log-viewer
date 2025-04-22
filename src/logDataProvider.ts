import * as vscode from 'vscode';
import { Connection } from 'jsforce';
import { DeveloperLog, DeveloperLogRecord } from './developerLog';
import { LogViewer } from './logViewer';

export interface LogDataChangeEvent {
    data: any[];
    isAutoRefresh: boolean;
}

export class LogDataProvider implements vscode.Disposable {
    private _onDidChangeData = new vscode.EventEmitter<LogDataChangeEvent>();
    readonly onDidChangeData = this._onDidChangeData.event;

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

    // Column definitions for the data grid
    readonly columns = [
        { label: 'User', field: 'user', width: 150 },
        { label: 'Time', field: 'time', width: 100 },
        { label: 'Status', field: 'status', width: 80 },
        { label: 'Size', field: 'size', width: 80 },
        { label: 'Operation', field: 'operation', width: 400 },
        { label: 'Duration', field: 'duration', width: 100 }
    ];

    constructor(
        context: vscode.ExtensionContext,
        public readonly connection: Connection,
        private readonly config: {
            autoRefresh: boolean;
            refreshInterval: number;
            currentUserOnly: boolean;
        }
    ) {
        console.log('Initializing LogDataProvider');
        this.context = context;
        this.logViewer = new LogViewer(vscode.workspace.rootPath);
        this.logs = [];
        this.filteredLogs = [];
        this.initialize();
    }

    private async initialize() {
        try {
            console.log('Starting LogDataProvider initialization');
            if (this.config.currentUserOnly) {
                this.currentUserId = await this.getCurrentUserId();
                console.log('Current user ID:', this.currentUserId);
            }
            
            // Initial load of logs
            await this.refreshLogs(true);
            
            // Start auto-refresh if configured
            if (this.config.autoRefresh) {
                this.startAutoRefresh();
            }
        } catch (error: any) {
            console.error('LogDataProvider initialization error:', error);
            vscode.window.showErrorMessage(`Failed to initialize log viewer: ${error.message}`);
        }
    }

    dispose() {
        this.stopAutoRefresh();
        this._onDidChangeData.dispose();
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

    private _notifyDataChange(isAutoRefresh: boolean = false) {
        const gridData = this.getGridData();
        this._onDidChangeData.fire({ data: gridData, isAutoRefresh });
    }

    public async refreshLogs(isInitialLoad: boolean = false, isManualRefresh: boolean = false): Promise<void> {
        if (this.isRefreshing) {
            return;
        }
        this.isRefreshing = true;
        console.log('Starting log refresh');
        try {
            const refreshDate = new Date();
            let query = 'SELECT Id, Application, DurationMilliseconds, LogLength, LogUser.Name, Operation, Request, StartTime, Status FROM ApexLog';

            if (this.config.currentUserOnly && this.currentUserId) {
                query += ` WHERE LogUserId = '${this.currentUserId}'`;
            }

            query += ' ORDER BY StartTime DESC LIMIT 100';
            console.log('Executing query:', query);

            const result = await this.connection.tooling.query<DeveloperLogRecord>(query);
            console.log('Query result:', result);
            this.lastRefresh = refreshDate; 

            if (result.records && result.records.length > 0) {
                const newLogs = result.records.map(record => new DeveloperLog(record, this.connection));
                console.log('Processed new logs:', newLogs.length);
                
                if (isInitialLoad) {
                    this.logs = newLogs;
                } else {
                    const uniqueLogEntries = new Map<string, DeveloperLog>();
                    newLogs.forEach(log => uniqueLogEntries.set(log.id, log)); 
                    this.logs.forEach(log => {
                        if (!uniqueLogEntries.has(log.id)) {
                            uniqueLogEntries.set(log.id, log);
                        }
                    });
                    this.logs = Array.from(uniqueLogEntries.values());
                }
            } else {
                console.log('No logs found in query result');
                this.logs = [];
            }
            
            this.logs = this.logs
                .filter(log => log.operation !== '<empty>')
                .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
                .slice(0, 100);

            console.log('Final processed logs:', this.logs.length);

            if (isInitialLoad || isManualRefresh) {
                this.searchText = '';
                this.filteredLogs = [...this.logs];
            } else {
                this._filterLogs();
            }

            // Notify with auto-refresh flag
            this._notifyDataChange(!isInitialLoad && !isManualRefresh);
        } catch (error: any) {
            console.error('Log refresh error:', error);
            vscode.window.showErrorMessage(`Failed to refresh logs: ${error.message}`);
        } finally {
            this.isRefreshing = false;
            this.scheduleRefresh(); 
        }
    }
    
    public getGridData(): any[] {
        console.log('Getting grid data, filtered logs count:', this.filteredLogs.length);
        return this.filteredLogs.map(log => {
            // Create a clean object with only the necessary data
            const cleanLog = {
                id: log.id,
                user: log.user,
                time: new Date(log.startTime).toLocaleTimeString('en-US', {
                    hour12: false,
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                }),
                status: log.status,
                size: `${(log.size / 1024).toFixed(1)}KB`,
                operation: log.operation,
                duration: `${log.durationMilliseconds}ms`,
                // Include only the necessary properties for opening the log
                logData: {
                    id: log.id,
                    startTime: log.startTime,
                    size: log.size,
                    status: log.status,
                    operation: log.operation,
                    user: log.user,
                    durationMilliseconds: log.durationMilliseconds
                }
            };
            return cleanLog;
        });
    }

    public setSearchFilter(text: string) {
        this.searchText = text;
        this._filterLogs();
        this._notifyDataChange(false);
    }

    public clearSearch() {
        this.searchText = '';
        this._filterLogs();
        this._notifyDataChange(false);
    }

    public getSearchFilter(): string {
        return this.searchText;
    }

    private _filterLogs() {
        if (!this.searchText) {
            this.filteredLogs = [...this.logs];
            return;
        }
        const searchLower = this.searchText.toLowerCase();
        this.filteredLogs = this.logs.filter(log => {
            const operation = log.operation.toLowerCase();
            const user = log.user.toLowerCase();
            return operation.includes(searchLower) || user.includes(searchLower);
        });
    }

    // Keep the existing configuration methods
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
        this._notifyDataChange(false);
    }

    public getCurrentUserOnlySetting(): boolean {
        return this.config.currentUserOnly;
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

    private async getCurrentUserId(): Promise<string> {
        const result = await this.connection.identity();
        return result.user_id;
    }
}