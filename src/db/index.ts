import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, 'schema.sql');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(fs.readFileSync(schemaPath, 'utf8'));

// Idempotent column migrations. CREATE TABLE IF NOT EXISTS won't add new
// columns to an existing table; ALTER TABLE ADD COLUMN handles that.
const migrations: { sql: string; ignoreIfExists?: boolean }[] = [
  { sql: `ALTER TABLE groups ADD COLUMN auto_approved INTEGER NOT NULL DEFAULT 0`, ignoreIfExists: true },
  // Replaces concise_mode boolean. DEFAULT 1 backfills existing rows to "light".
  { sql: `ALTER TABLE groups ADD COLUMN polish_level INTEGER NOT NULL DEFAULT 1`, ignoreIfExists: true },
];
for (const m of migrations) {
  try {
    db.exec(m.sql);
  } catch (err: any) {
    if (m.ignoreIfExists && /duplicate column name/i.test(err?.message ?? '')) continue;
    throw err;
  }
}

export type GroupRow = {
  jid: string;
  label: string;
  target_languages: string;
  enabled: number;
  voice_translate: number;
  text_translate_on_mention: number;
  polish_level: number;
  show_source_label: number;
  show_processing_reaction: number;
  max_audio_seconds: number;
  monthly_budget_cents: number;
  created_by_ninja: number;
  auto_approved: number;
  invite_link: string | null;
  notes: string | null;
  last_translated_at: string | null;
  created_at: string;
};

export type Group = {
  jid: string;
  label: string;
  targetLanguages: string[];
  enabled: boolean;
  voiceTranslate: boolean;
  textTranslateOnMention: boolean;
  polishLevel: number;
  showSourceLabel: boolean;
  showProcessingReaction: boolean;
  maxAudioSeconds: number;
  monthlyBudgetCents: number;
  createdByNinja: boolean;
  autoApproved: boolean;
  inviteLink: string | null;
  notes: string | null;
  lastTranslatedAt: string | null;
  createdAt: string;
};

function rowToGroup(r: GroupRow): Group {
  return {
    jid: r.jid,
    label: r.label,
    targetLanguages: JSON.parse(r.target_languages),
    enabled: !!r.enabled,
    voiceTranslate: !!r.voice_translate,
    textTranslateOnMention: !!r.text_translate_on_mention,
    polishLevel: r.polish_level,
    showSourceLabel: !!r.show_source_label,
    showProcessingReaction: !!r.show_processing_reaction,
    maxAudioSeconds: r.max_audio_seconds,
    monthlyBudgetCents: r.monthly_budget_cents,
    createdByNinja: !!r.created_by_ninja,
    autoApproved: !!r.auto_approved,
    inviteLink: r.invite_link,
    notes: r.notes,
    lastTranslatedAt: r.last_translated_at,
    createdAt: r.created_at,
  };
}

const stmts = {
  getGroup: db.prepare<[string], GroupRow>('SELECT * FROM groups WHERE jid = ?'),
  listGroups: db.prepare<[], GroupRow>('SELECT * FROM groups ORDER BY last_translated_at DESC NULLS LAST, created_at DESC'),
  upsertGroup: db.prepare(`
    INSERT INTO groups (jid, label, target_languages, enabled, voice_translate, text_translate_on_mention,
                        polish_level, show_source_label, show_processing_reaction, max_audio_seconds,
                        monthly_budget_cents, created_by_ninja, auto_approved, invite_link, notes)
    VALUES (@jid, @label, @target_languages, @enabled, @voice_translate, @text_translate_on_mention,
            @polish_level, @show_source_label, @show_processing_reaction, @max_audio_seconds,
            @monthly_budget_cents, @created_by_ninja, @auto_approved, @invite_link, @notes)
    ON CONFLICT(jid) DO UPDATE SET
      label = excluded.label,
      target_languages = excluded.target_languages,
      enabled = excluded.enabled,
      voice_translate = excluded.voice_translate,
      text_translate_on_mention = excluded.text_translate_on_mention,
      polish_level = excluded.polish_level,
      show_source_label = excluded.show_source_label,
      show_processing_reaction = excluded.show_processing_reaction,
      max_audio_seconds = excluded.max_audio_seconds,
      monthly_budget_cents = excluded.monthly_budget_cents,
      auto_approved = excluded.auto_approved,
      invite_link = excluded.invite_link,
      notes = excluded.notes
  `),
  deleteGroup: db.prepare('DELETE FROM groups WHERE jid = ?'),
  touchGroup: db.prepare("UPDATE groups SET last_translated_at = datetime('now') WHERE jid = ?"),

  getPending: db.prepare<[string], any>('SELECT * FROM pending_groups WHERE jid = ?'),
  listPending: db.prepare<[], any>("SELECT * FROM pending_groups WHERE status = 'pending' ORDER BY first_seen_at DESC"),
  upsertPending: db.prepare(`
    INSERT INTO pending_groups (jid, subject, participants, inviter_jid, inviter_name, sample_messages)
    VALUES (@jid, @subject, @participants, @inviter_jid, @inviter_name, @sample_messages)
    ON CONFLICT(jid) DO UPDATE SET
      subject = COALESCE(excluded.subject, pending_groups.subject),
      participants = COALESCE(excluded.participants, pending_groups.participants),
      sample_messages = excluded.sample_messages
  `),
  deletePending: db.prepare('DELETE FROM pending_groups WHERE jid = ?'),
  appendPendingSample: db.prepare(`
    UPDATE pending_groups
       SET sample_messages = json(?)
     WHERE jid = ?
  `),

  insertRejected: db.prepare(`
    INSERT OR REPLACE INTO rejected_groups (jid, inviter_jid, reason)
    VALUES (?, ?, ?)
  `),
  getRejected: db.prepare<[string], any>('SELECT * FROM rejected_groups WHERE jid = ?'),

  insertMessage: db.prepare(`
    INSERT OR IGNORE INTO messages
      (group_jid, wa_message_id, sender_jid, sender_name, kind, source_lang, source_text,
       translations, audio_seconds, gemini_tokens_in, gemini_tokens_out, cost_cents)
    VALUES (@group_jid, @wa_message_id, @sender_jid, @sender_name, @kind, @source_lang, @source_text,
            @translations, @audio_seconds, @gemini_tokens_in, @gemini_tokens_out, @cost_cents)
  `),
  listMessages: db.prepare<[string, number, number], any>(`
    SELECT * FROM messages
     WHERE group_jid = ?
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?
  `),

  bumpUsageDaily: db.prepare(`
    INSERT INTO usage_daily (group_jid, date, messages_count, audio_seconds_total, cost_cents_total)
    VALUES (?, date('now'), 1, COALESCE(?, 0), ?)
    ON CONFLICT(group_jid, date) DO UPDATE SET
      messages_count = messages_count + 1,
      audio_seconds_total = audio_seconds_total + COALESCE(excluded.audio_seconds_total, 0),
      cost_cents_total = cost_cents_total + excluded.cost_cents_total
  `),
  getSetting: db.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?'),
  upsertSetting: db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `),

  monthCostForGroup: db.prepare<[string], { total: number }>(`
    SELECT COALESCE(SUM(cost_cents_total), 0) AS total
      FROM usage_daily
     WHERE group_jid = ? AND substr(date, 1, 7) = strftime('%Y-%m', 'now')
  `),
  monthCostAll: db.prepare<[], any>(`
    SELECT group_jid, COALESCE(SUM(cost_cents_total), 0) AS total
      FROM usage_daily
     WHERE substr(date, 1, 7) = strftime('%Y-%m', 'now')
     GROUP BY group_jid
  `),
};

export const repo = {
  getGroup(jid: string): Group | null {
    const row = stmts.getGroup.get(jid);
    return row ? rowToGroup(row) : null;
  },
  listGroups(): Group[] {
    return stmts.listGroups.all().map(rowToGroup);
  },
  upsertGroup(g: Group): void {
    stmts.upsertGroup.run({
      jid: g.jid,
      label: g.label,
      target_languages: JSON.stringify(g.targetLanguages),
      enabled: g.enabled ? 1 : 0,
      voice_translate: g.voiceTranslate ? 1 : 0,
      text_translate_on_mention: g.textTranslateOnMention ? 1 : 0,
      polish_level: g.polishLevel,
      show_source_label: g.showSourceLabel ? 1 : 0,
      show_processing_reaction: g.showProcessingReaction ? 1 : 0,
      max_audio_seconds: g.maxAudioSeconds,
      monthly_budget_cents: g.monthlyBudgetCents,
      created_by_ninja: g.createdByNinja ? 1 : 0,
      auto_approved: g.autoApproved ? 1 : 0,
      invite_link: g.inviteLink,
      notes: g.notes,
    });
  },
  deleteGroup(jid: string): void {
    stmts.deleteGroup.run(jid);
  },
  touchGroup(jid: string): void {
    stmts.touchGroup.run(jid);
  },

  getPending(jid: string): any | null {
    return stmts.getPending.get(jid) ?? null;
  },
  listPending(): any[] {
    return stmts.listPending.all();
  },
  upsertPending(p: {
    jid: string;
    subject: string | null;
    participants: string[] | null;
    inviterJid: string | null;
    inviterName: string | null;
    sampleMessages: unknown[];
  }): void {
    stmts.upsertPending.run({
      jid: p.jid,
      subject: p.subject,
      participants: p.participants ? JSON.stringify(p.participants) : null,
      inviter_jid: p.inviterJid,
      inviter_name: p.inviterName,
      sample_messages: JSON.stringify(p.sampleMessages),
    });
  },
  deletePending(jid: string): void {
    stmts.deletePending.run(jid);
  },
  reject(jid: string, inviterJid: string | null, reason: string | null): void {
    stmts.insertRejected.run(jid, inviterJid, reason);
    stmts.deletePending.run(jid);
  },
  isRejected(jid: string): boolean {
    return !!stmts.getRejected.get(jid);
  },

  insertMessage(m: {
    groupJid: string;
    waMessageId: string;
    senderJid: string | null;
    senderName: string | null;
    kind: 'voice' | 'text';
    sourceLang: string | null;
    sourceText: string | null;
    translations: Record<string, string> | null;
    audioSeconds: number | null;
    geminiTokensIn: number | null;
    geminiTokensOut: number | null;
    costCents: number;
  }): void {
    stmts.insertMessage.run({
      group_jid: m.groupJid,
      wa_message_id: m.waMessageId,
      sender_jid: m.senderJid,
      sender_name: m.senderName,
      kind: m.kind,
      source_lang: m.sourceLang,
      source_text: m.sourceText,
      translations: m.translations ? JSON.stringify(m.translations) : null,
      audio_seconds: m.audioSeconds,
      gemini_tokens_in: m.geminiTokensIn,
      gemini_tokens_out: m.geminiTokensOut,
      cost_cents: m.costCents,
    });
    stmts.bumpUsageDaily.run(m.groupJid, m.audioSeconds, m.costCents);
  },
  listMessages(groupJid: string, limit = 50, offset = 0): any[] {
    return stmts.listMessages.all(groupJid, limit, offset);
  },

  monthCostForGroup(jid: string): number {
    return stmts.monthCostForGroup.get(jid)?.total ?? 0;
  },
  monthCostAll(): { group_jid: string; total: number }[] {
    return stmts.monthCostAll.all() as any;
  },

  getSetting<T>(key: string, fallback: T): T {
    const row = stmts.getSetting.get(key);
    if (!row) return fallback;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return fallback;
    }
  },
  setSetting(key: string, value: unknown): void {
    stmts.upsertSetting.run(key, JSON.stringify(value));
  },
};

// Typed accessor for the open-mode feature flag (the only setting today).
export const openMode = {
  isEnabled(): boolean {
    return repo.getSetting<boolean>('open_mode_enabled', false);
  },
  setEnabled(v: boolean): void {
    repo.setSetting('open_mode_enabled', v);
  },
  defaultLanguages(): string[] {
    return repo.getSetting<string[]>('open_mode_default_languages', ['en', 'th']);
  },
  setDefaultLanguages(langs: string[]): void {
    repo.setSetting('open_mode_default_languages', langs);
  },
};
