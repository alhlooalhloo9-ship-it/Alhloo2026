/* Automatic local safety snapshots for بضاعة الندوة.
   Does not sync remotely, clear storage, or alter the app's data schema. */
(function () {
  'use strict';
  const BACKUP_KEY = 'nadba_safety_backup_v1';
  const KEYS = [
    'nadba_catalog', 'nadba_saved_invoices', 'nadba_settings',
    'nadba_shops', 'nadba_cart', 'nadba_sales', 'nadba_ui',
    'nadba_cardshow', 'nadba_sort'
  ];
  const nativeSet = Storage.prototype.setItem;
  let busy = false;

  function parse(raw, expected) {
    if (raw == null) return null;
    try {
      const value = JSON.parse(raw);
      if (expected === 'array' && !Array.isArray(value)) return null;
      if (expected === 'object' && (!value || typeof value !== 'object' || Array.isArray(value))) return null;
      return value;
    } catch (_) { return null; }
  }
  function readValidSnapshot() {
    const values = {};
    for (const key of KEYS) {
      const raw = localStorage.getItem(key);
      if (raw == null) continue;
      const expected = key === 'nadba_catalog' || key === 'nadba_saved_invoices' ||
        key === 'nadba_shops' || key === 'nadba_sales' ? 'array' :
        key === 'nadba_sort' ? null : 'object';
      if (expected && parse(raw, expected) === null) return null;
      values[key] = raw;
    }
    return values;
  }
  function saveSnapshot() {
    if (busy) return;
    const values = readValidSnapshot();
    if (!values) return;
    const catalog = parse(values.nadba_catalog, 'array');
    const previous = parse(localStorage.getItem(BACKUP_KEY), 'object');
    // Never replace a useful backup with an empty/invalid catalog snapshot.
    if ((!catalog || catalog.length === 0) &&
        previous && Array.isArray(previous.values && parse(previous.values.nadba_catalog, 'array')) &&
        parse(previous.values.nadba_catalog, 'array').length > 0) return;
    const snapshot = { version: 1, savedAt: Date.now(), values };
    try {
      busy = true;
      nativeSet.call(localStorage, BACKUP_KEY, JSON.stringify(snapshot));
    } catch (_) {
      // Quota/security failures must not interrupt the user's normal save.
    } finally { busy = false; }
  }
  function recoverIfCatalogWasUnexpectedlyEmptied() {
    const current = parse(localStorage.getItem('nadba_catalog'), 'array');
    const backup = parse(localStorage.getItem(BACKUP_KEY), 'object');
    const savedProducts = backup && backup.values
      ? parse(backup.values.nadba_catalog, 'array') : null;
    if (current && current.length > 0) return;
    if (!savedProducts || savedProducts.length === 0) return;
    // Restore only when the current catalog is missing/empty. Never overwrite
    // a populated catalog with an older snapshot.
    try {
      busy = true;
      for (const key of KEYS) {
        if (Object.prototype.hasOwnProperty.call(backup.values, key)) {
          nativeSet.call(localStorage, key, backup.values[key]);
        }
      }
      nativeSet.call(localStorage, 'nadba_safety_recovery_notice',
        JSON.stringify({ recoveredAt: Date.now(), productCount: savedProducts.length }));
    } catch (_) {
      // Leave the backup intact for a later retry/manual recovery.
    } finally { busy = false; }
  }

  // Recover before the app's inline script reads its arrays/settings.
  recoverIfCatalogWasUnexpectedlyEmptied();

  // Snapshot after every successful write to a business-data key.
  Storage.prototype.setItem = function (key, value) {
    nativeSet.call(this, key, value);
    if (!busy && KEYS.includes(String(key))) saveSnapshot();
  };

  // Create the first snapshot once the existing data is available.
  saveSnapshot();
  window.addEventListener('pagehide', saveSnapshot);
  window.addEventListener('beforeunload', saveSnapshot);
})();