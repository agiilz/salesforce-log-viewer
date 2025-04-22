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
exports.LogViewer = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs-extra"));
const luxon_1 = require("luxon");
class LogViewer {
    constructor(storagePath) {
        this.storagePath = storagePath;
    }
    get logsPath() {
        return this.storagePath ? path.resolve(this.storagePath, '.logs') : undefined;
    }
    async showLog(log) {
        const logBody = await log.getBody();
        const fileName = luxon_1.DateTime.fromJSDate(log.startTime)
            .toFormat('MM-dd-yyyy_HH-mm-ss')
            .replace(/\//g, '-') + '_' + log.id + '.log';
        return this.openLog(logBody, fileName);
    }
    async openLog(logBody, logFileName) {
        const formattedLog = this.formatLog(logBody);
        if (this.logsPath) {
            const fullLogPath = path.join(this.logsPath, logFileName);
            await fs.ensureDir(this.logsPath);
            await fs.writeFile(fullLogPath, formattedLog);
            const document = await vscode.workspace.openTextDocument(fullLogPath);
            if (document) {
                await vscode.languages.setTextDocumentLanguage(document, 'apexlog');
                await vscode.window.showTextDocument(document, { preview: true });
            }
        }
        else {
            const document = await vscode.workspace.openTextDocument({ content: formattedLog });
            if (document) {
                await vscode.languages.setTextDocumentLanguage(document, 'apexlog');
                await vscode.window.showTextDocument(document, { preview: true });
            }
        }
    }
    formatLog(log) {
        // Strip any duplicate ENTERING_MANAGED_PKG statements
        return log.replace(/(^[0-9:.() ]+\|ENTERING_MANAGED_PKG\|.*\n)+/gm, '$1');
    }
}
exports.LogViewer = LogViewer;
LogViewer.START_MARKER = '|CODE_UNIT_STARTED|[EXTERNAL]|execute_anonymous_apex\n';
LogViewer.END_MARKER = '|CODE_UNIT_FINISHED|execute_anonymous_apex\n';
//# sourceMappingURL=logViewer.js.map