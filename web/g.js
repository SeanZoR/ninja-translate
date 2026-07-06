// API base URL: read from <meta name="api-base">. Defaults to same-origin.
const API_BASE = (() => {
  const meta = document.querySelector('meta[name="api-base"]');
  const v = meta?.getAttribute('content')?.trim();
  return v && v.length > 0 ? v.replace(/\/$/, '') : '';
})();

const api = (path) => `${API_BASE}${path}`;

// Mirror src/translator/gemini.ts LANGUAGE_NAMES + FLAGS.
const AVAILABLE_LANGUAGES = [
  { code: 'en', name: 'English',    flag: '🇬🇧' },
  { code: 'th', name: 'Thai',       flag: '🇹🇭' },
  { code: 'he', name: 'Hebrew',     flag: '🇮🇱' },
  { code: 'my', name: 'Burmese',    flag: '🇲🇲' },
  { code: 'ms', name: 'Malay',      flag: '🇲🇾' },
  { code: 'tl', name: 'Tagalog',    flag: '🇵🇭' },
  { code: 'id', name: 'Indonesian', flag: '🇮🇩' },
  { code: 'es', name: 'Spanish',    flag: '🇪🇸' },
  { code: 'ru', name: 'Russian',    flag: '🇷🇺' },
  { code: 'zh', name: 'Chinese',    flag: '🇨🇳' },
  { code: 'fr', name: 'French',     flag: '🇫🇷' },
  { code: 'de', name: 'German',     flag: '🇩🇪' },
];

const POLISH_OPTIONS = [
  { value: 0, title: 'Verbatim',         sub: 'Keep ums and false starts as spoken.' },
  { value: 1, title: 'Light cleanup',    sub: 'Drop obvious filler sounds.' },
  { value: 2, title: 'Medium cleanup',   sub: 'Drop fillers and tighten phrasing.' },
  { value: 3, title: 'Rewrite for clarity', sub: 'Polish into clear natural prose.' },
];

function tokenFromUrl() {
  const m = location.pathname.match(/\/g\/([^/?#]+)/);
  return m ? m[1] : null;
}

function groupPage() {
  return {
    AVAILABLE_LANGUAGES,
    POLISH_OPTIONS,

    state: 'loading',                 // 'loading' | 'ready' | 'expired'
    groupName: null,
    busy: false,
    savedAt: null,
    error: null,
    expiredReason: 'Mention the Ninja bot with the word "language" in your group to get a fresh link. Group settings are unchanged.',

    // Effective group values — no override/inherit concept here: the group
    // row IS the base config, admins edit it directly.
    f: {
      targetLanguages: [],
      voiceTranslate: true,
      textTranslateOnMention: true,
      polishLevel: 2,
      showSourceLabel: true,
      showProcessingReaction: false,
    },

    async init() {
      const token = tokenFromUrl();
      if (!token) {
        this.state = 'expired';
        return;
      }
      try {
        const resp = await fetch(api(`/api/g/${encodeURIComponent(token)}/settings`));
        if (!resp.ok) {
          this.state = 'expired';
          if (resp.status === 403) {
            this.expiredReason = 'You are no longer an admin of this group, so this link stopped working.';
          } else if (resp.status === 503) {
            this.expiredReason = 'The bot is offline right now — try again in a minute.';
          }
          return;
        }
        const data = await resp.json();
        this.groupName = data.groupName ?? null;
        this.applyServerState(data.settings ?? {});
        this.state = 'ready';
      } catch (err) {
        this.state = 'expired';
        this.expiredReason = `Couldn't load settings: ${err.message ?? err}`;
      }
    },

    applyServerState(s) {
      this.f.targetLanguages        = Array.isArray(s.targetLanguages) ? [...s.targetLanguages] : [];
      this.f.voiceTranslate         = s.voiceTranslate         ?? true;
      this.f.textTranslateOnMention = s.textTranslateOnMention ?? true;
      this.f.polishLevel            = s.polishLevel            ?? 2;
      this.f.showSourceLabel        = s.showSourceLabel        ?? true;
      this.f.showProcessingReaction = s.showProcessingReaction ?? false;
    },

    toggleLang(code) {
      const i = this.f.targetLanguages.indexOf(code);
      if (i >= 0) this.f.targetLanguages.splice(i, 1);
      else this.f.targetLanguages.push(code);
    },

    async save() {
      if (this.f.targetLanguages.length === 0) {
        this.error = 'Pick at least one language';
        return;
      }
      this.busy = true;
      this.error = null;
      try {
        const token = tokenFromUrl();
        const resp = await fetch(api(`/api/g/${encodeURIComponent(token)}/settings`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetLanguages:        this.f.targetLanguages,
            voiceTranslate:         !!this.f.voiceTranslate,
            textTranslateOnMention: !!this.f.textTranslateOnMention,
            polishLevel:            this.f.polishLevel,
            showSourceLabel:        !!this.f.showSourceLabel,
            showProcessingReaction: !!this.f.showProcessingReaction,
          }),
        });
        if (resp.status === 404 || resp.status === 403) {
          this.state = 'expired';
          if (resp.status === 403) {
            this.expiredReason = 'You are no longer an admin of this group, so this link stopped working.';
          }
          return;
        }
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        this.savedAt = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      } catch (err) {
        this.error = `Save failed: ${err.message ?? err}`;
      } finally {
        this.busy = false;
      }
    },
  };
}

window.groupPage = groupPage;
