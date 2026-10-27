import { readState } from './core.js';

// Android owns a synchronous, atomic disk checkpoint; localStorage remains the web store/mirror.
export function createLedgerStore(storage, key, bridge = null) {
  const native = !!bridge && typeof bridge.loadLedger === 'function' && typeof bridge.saveLedger === 'function';
  return {
    native,
    loadRecovery() {
      return native && typeof bridge.loadRecovery === 'function' ? bridge.loadRecovery() : storage.getItem(key+'-recovery');
    },
    saveRecovery(raw) {
      if (native && typeof bridge.saveRecovery === 'function') {
        if (!bridge.saveRecovery(raw)) throw Error('恢复前备份未能保存，原账本未更改');
      } else storage.setItem(key+'-recovery', raw);
    },
    load() {
      const checkpointRaw = native ? bridge.loadLedger() : null;
      const checkpoint = checkpointRaw ? readState(checkpointRaw) : null;
      let raw;
      try { raw = storage.getItem(key); } catch (error) { if (!checkpoint) throw error; }
      const browser = raw ? readState(raw) : null;
      // An equally recent browser value can contain an unsynchronized legacy/cross-window edit.
      return checkpoint && (!browser || checkpoint.revision > browser.revision) ? checkpoint : browser;
    },
    save(state) {
      const raw = JSON.stringify(state);
      if (native && !bridge.saveLedger(raw)) throw Error('账本未能写入本机，未确认保存。请检查可用空间并重试');
      try { storage.setItem(key, raw); } catch (error) { if (!native) throw error; }
    }
  };
}
