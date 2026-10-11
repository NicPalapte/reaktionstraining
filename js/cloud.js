// Optionales Konto und Abgleich mit Supabase.
// Die App arbeitet immer zuerst lokal (IndexedDB). Ist man angemeldet, werden Zeiten zusätzlich
// hochgeladen und fehlende Zeiten von anderen Geräten geladen (Abgleich über die Zeilen-ID).

import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { store } from './storage.js';

const SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const TRIAL_COLS = ['id', 'created_at', 'exercise', 'session_id', 'direction', 'reaction_ms', 'run_ms', 'total_ms', 'split_a_ms', 'split_b_ms', 'valid', 'reason'];
const SESSION_COLS = ['id', 'created_at', 'exercise', 'session_id', 'rounds', 'duration_ms', 'best_run_ms', 'avg_run_ms', 'avg_reaction_ms', 'meta'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 1000;

const pick = (row, cols) => Object.fromEntries(cols.filter((c) => row[c] !== undefined).map((c) => [c, row[c]]));

class Cloud {
  constructor() {
    this.sb = null;
    this.user = null;
    this.lastSync = null;
    this.lastError = null;
    this.syncing = false;
    this.timer = null;
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
  }

  emit() {
    this.listeners.forEach((fn) => fn());
  }

  /** Beim Start: nur laden, wenn schon einmal angemeldet (spart den Download für Offline-Nutzer). */
  async init() {
    let known = false;
    try {
      known = Object.keys(localStorage).some((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
    } catch {
      /* kein localStorage */
    }
    if (known) await this.client().catch((e) => (this.lastError = this.msg(e)));
    this.emit();
  }

  async client() {
    if (this.sb) return this.sb;
    const { createClient } = await import(SDK);
    this.sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
    this.sb.auth.onAuthStateChange((_ev, session) => {
      const was = this.user?.id;
      this.user = session?.user ?? null;
      if (this.user && this.user.id !== was) this.sync();
      this.emit();
    });
    const { data } = await this.sb.auth.getSession();
    this.user = data.session?.user ?? null;
    if (this.user) this.sync();
    return this.sb;
  }

  msg(e) {
    const m = String(e?.message || e);
    if (/invalid login credentials/i.test(m)) return 'E-Mail oder Passwort falsch.';
    if (/already registered|already exists/i.test(m)) return 'Diese E-Mail ist schon registriert. Bitte anmelden.';
    if (/password.*(at least|short)|weak/i.test(m)) return 'Das Passwort ist zu kurz (mindestens 6 Zeichen).';
    if (/email not confirmed/i.test(m)) return 'Bitte zuerst die E-Mail bestätigen.';
    if (/rate limit/i.test(m)) return 'Zu viele Versuche. Bitte kurz warten.';
    if (/fetch|network|load|import/i.test(m)) return 'Keine Verbindung zu Supabase.';
    return m;
  }

  async signIn(email, password) {
    const sb = await this.client();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(this.msg(error));
  }

  /** @returns {Promise<boolean>} true = sofort angemeldet, false = Bestätigungsmail nötig */
  async signUp(email, password) {
    const sb = await this.client();
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) throw new Error(this.msg(error));
    return !!data.session;
  }

  async signOut() {
    if (!this.sb) return;
    await this.sb.auth.signOut();
    this.user = null;
    this.lastSync = null;
    this.emit();
  }

  /** Nach dem Speichern kurz bündeln und hochladen. */
  scheduleSync() {
    if (!this.user) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync(), 1500);
  }

  async fetchAll(table, cols) {
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.sb.from(table).select(cols).order('created_at').range(from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...data);
      if (data.length < PAGE) break;
    }
    return rows;
  }

  async sync() {
    if (!this.user || this.syncing || !navigator.onLine) return;
    this.syncing = true;
    this.lastError = null;
    this.emit();
    try {
      for (const [table, cols, local, put] of [
        ['trials', TRIAL_COLS, () => store.listTrials(), (r) => store.put('trials', r)],
        ['sessions', SESSION_COLS, () => store.listSessions(), (r) => store.put('sessions', r)],
      ]) {
        const remote = await this.fetchAll(table, cols.join(','));
        const remoteIds = new Set(remote.map((r) => r.id));
        const mine = await local();
        const localIds = new Set(mine.map((r) => r.id));
        const up = mine.filter((r) => UUID.test(r.id) && !remoteIds.has(r.id)).map((r) => pick(r, cols));
        for (let i = 0; i < up.length; i += 200) {
          const { error } = await this.sb.from(table).upsert(up.slice(i, i + 200), { onConflict: 'id', ignoreDuplicates: true });
          if (error) throw error;
        }
        for (const r of remote) if (!localIds.has(r.id)) await put(r);
      }
      this.lastSync = new Date();
    } catch (e) {
      console.warn('Abgleich fehlgeschlagen', e);
      this.lastError = this.msg(e);
    } finally {
      this.syncing = false;
      this.emit();
    }
  }

  /** "Alles löschen" gilt auch für die Cloud, sonst käme alles beim nächsten Abgleich zurück. */
  async deleteRemote() {
    if (!this.user) return;
    for (const table of ['trials', 'sessions']) {
      const { error } = await this.sb.from(table).delete().eq('user_id', this.user.id);
      if (error) throw error;
    }
  }
}

export const cloud = new Cloud();
