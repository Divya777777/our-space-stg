// HTTP long polling: keep the request open and wake it as soon as data changes.
// No timers gate delivery. Timeout only supplies a heartbeat and recovery path.
class ChangeFeed {
  constructor() { this.sequence = Date.now(); this.epoch = this.sequence; this.versions = new Map(); this.waiters = new Map(); }
  version(channel) { return this.versions.get(channel) || this.epoch; }
  notify(channel) {
    this.versions.set(channel, ++this.sequence);
    for (const wake of [...(this.waiters.get(channel) || [])]) wake();
  }
  wait(channel, cursor, response, timeoutMs = 15000) {
    if (Number(cursor) !== this.version(channel) || response.destroyed) return Promise.resolve();
    return new Promise(resolve => {
      let timer;
      const done = () => {
        clearTimeout(timer); response.removeListener('close', done);
        const waiting = this.waiters.get(channel); waiting?.delete(done);
        if (!waiting?.size) this.waiters.delete(channel);
        resolve();
      };
      if (!this.waiters.has(channel)) this.waiters.set(channel, new Set());
      this.waiters.get(channel).add(done);
      response.once('close', done);
      timer = setTimeout(done, timeoutMs);
      if (response.destroyed || Number(cursor) !== this.version(channel)) done();
    });
  }
  close() { for (const pending of [...this.waiters.values()]) for (const done of [...pending]) done(); }
}
module.exports = { ChangeFeed };
