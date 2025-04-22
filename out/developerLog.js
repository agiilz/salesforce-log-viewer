"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeveloperLog = void 0;
class DeveloperLog {
    get id() { return this.entry.Id; }
    get application() { return this.entry.Application; }
    get startTime() { return new Date(this.entry.StartTime); }
    get durationMilliseconds() { return this.entry.DurationMilliseconds; }
    get location() { return this.entry.Location; }
    get size() { return this.entry.LogLength; }
    get user() { return this.entry.LogUser.Name; }
    get operation() { return this.entry.Operation; }
    get request() { return this.entry.Request; }
    get status() { return this.entry.Status; }
    constructor(entry, connection) {
        this.entry = entry;
        this.connection = connection;
    }
    async getBody() {
        const response = await this.connection.tooling.request(`/sobjects/ApexLog/${this.entry.Id}/Body`);
        return response;
    }
}
exports.DeveloperLog = DeveloperLog;
//# sourceMappingURL=developerLog.js.map