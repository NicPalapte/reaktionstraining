// Datenzugriff hinter einer kleinen Schnittstelle.
// Heute: IndexedDB im Browser. Später: SupabaseStore mit derselben Schnittstelle
// (siehe README und supabase/schema.sql), die UI muss dafür nicht geändert werden.
//
// Schnittstelle:
//   addTrial(trial)      -> gespeicherter Eintrag (mit id, created_at)
//   addSession(session)  -> gespeicherter Eintrag
//   listTrials(exercise) -> Einträge, älteste zuerst
//   listSessions()       -> Einträge, älteste zuerst
//   putStrength(row)     -> Krafttraining-Eintrag anlegen oder ersetzen (id = fester Schlüssel, siehe strength-plan.js)
//   listStrength()       -> alle Krafttraining-Einträge
//   deleteAll()
//   exportCSV()          -> String

const DB_NAME = 'tennis-reaktion';
const DB_VERSION = 2;

const uid = () =>
  globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ['trials', 'sessions']) {
        if (db.objectStoreNames.contains(name)) continue;
        db.createObjectStore(name, { keyPath: 'id' }).createIndex('created_at', 'created_at');
      }
      // v2: Krafttraining, Einträge werden überschrieben (letzte Änderung gewinnt)
      if (!db.objectStoreNames.contains('strength')) db.createObjectStore('strength', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      // Neuere Version in einem anderen Tab/Fenster: Verbindung freigeben, sonst hängt dessen Upgrade
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
}

const wrap = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export class LocalStore {
  constructor() {
    this.name = 'local';
    this.dbp = null;
    this.memory = { trials: [], sessions: [], strength: [] }; // Notnagel, falls IndexedDB nicht verfügbar ist
    this.useMemory = false;
  }

  async db() {
    if (!this.dbp) this.dbp = openDb();
    return this.dbp;
  }

  async put(storeName, row) {
    if (!this.useMemory) {
      try {
        const db = await this.db();
        await wrap(db.transaction(storeName, 'readwrite').objectStore(storeName).put(row));
        return row;
      } catch (e) {
        console.warn('IndexedDB nicht verfügbar, speichere nur im Arbeitsspeicher', e);
        this.useMemory = true;
      }
    }
    const list = this.memory[storeName];
    const i = list.findIndex((r) => r.id === row.id);
    if (i >= 0) list[i] = row;
    else list.push(row);
    return row;
  }

  async all(storeName) {
    let rows;
    if (!this.useMemory) {
      try {
        const db = await this.db();
        rows = await wrap(db.transaction(storeName).objectStore(storeName).getAll());
      } catch (e) {
        this.useMemory = true;
      }
    }
    rows ??= this.memory[storeName];
    return [...rows].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  }

  addTrial(trial) {
    return this.put('trials', { id: uid(), created_at: new Date().toISOString(), ...trial });
  }

  addSession(session) {
    return this.put('sessions', { id: uid(), created_at: new Date().toISOString(), ...session });
  }

  async listTrials(exercise) {
    const rows = await this.all('trials');
    return exercise ? rows.filter((r) => r.exercise === exercise) : rows;
  }

  listSessions() {
    return this.all('sessions');
  }

  putStrength(row) {
    const now = new Date().toISOString();
    return this.put('strength', { created_at: now, ...row, updated_at: row.updated_at ?? now });
  }

  listStrength() {
    return this.all('strength');
  }

  async deleteAll() {
    // Das Krafttraining bleibt bewusst erhalten, es hat mit den Reaktionszeiten nichts zu tun.
    this.memory = { ...this.memory, trials: [], sessions: [] };
    try {
      const db = await this.db();
      await wrap(db.transaction('trials', 'readwrite').objectStore('trials').clear());
      await wrap(db.transaction('sessions', 'readwrite').objectStore('sessions').clear());
    } catch (e) {
      /* nichts zu löschen */
    }
  }

  async exportCSV() {
    const trials = await this.all('trials');
    const cols = ['created_at', 'exercise', 'session_id', 'direction', 'reaction_ms', 'run_ms', 'total_ms', 'split_a_ms', 'split_b_ms', 'valid', 'reason'];
    const esc = (v) => {
      if (v == null) return '';
      const str = String(v);
      return /[",\n]/.test(str) ? `"${str.replaceAll('"', '""')}"` : str;
    };
    return [cols.join(','), ...trials.map((t) => cols.map((c) => esc(t[c])).join(','))].join('\n');
  }
}

export const store = new LocalStore();

export const newSessionId = uid;
