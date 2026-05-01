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

const TONE_OPTIONS = [
  { value: 'formal',  title: 'Formal' },
  { value: 'neutral', title: 'Neutral' },
  { value: 'casual',  title: 'Casual' },
];

function tokenFromUrl() {
  const m = location.pathname.match(/\/u\/([^/?#]+)/);
  return m ? m[1] : null;
}

function userPage() {
  return {
    AVAILABLE_LANGUAGES,
    POLISH_OPTIONS,
    TONE_OPTIONS,

    state: 'loading',                 // 'loading' | 'ready' | 'expired'
    showIntro: !localStorage.getItem('ninjaSeenIntro'),
    hasVideo: true,
    busy: false,
    savedAt: null,
    error: null,

    // The form holds the *effective* current value for each setting. The
    // user doesn't see "override vs inherit" — they just see and edit the
    // current value. On save we persist these as overrides; "Reset to
    // defaults" wipes overrides back to null so the group's value is used.
    f: {
      polishLevel: 2,
      tone: 'neutral',
      sourceLanguageHint: null,
      voiceTranslate: true,
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
        const resp = await fetch(api(`/api/u/${encodeURIComponent(token)}/me`));
        if (resp.status === 404) {
          this.state = 'expired';
          return;
        }
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        this.applyServerState(data);
        this.state = 'ready';
      } catch (err) {
        this.state = 'expired';
        this.error = `Couldn't load settings: ${err.message ?? err}`;
      }
    },

    applyServerState(data) {
      const o = data.overrides ?? {};
      const d = data.defaults ?? {};
      // Effective value = override if set, otherwise group default. Stash
      // both so we can render and so reset works.
      this.f.polishLevel              = o.polishLevel              ?? d.polishLevel              ?? 2;
      this.f.tone                     = o.tone                     ?? d.tone                     ?? 'neutral';
      this.f.sourceLanguageHint       = o.sourceLanguageHint       ?? d.sourceLanguageHint       ?? null;
      this.f.voiceTranslate           = o.voiceTranslate           ?? d.voiceTranslate           ?? true;
      this.f.showSourceLabel          = o.showSourceLabel          ?? d.showSourceLabel          ?? true;
      this.f.showProcessingReaction   = o.showProcessingReaction   ?? d.showProcessingReaction   ?? false;
    },

    formToOverrides() {
      // Always send the displayed values as explicit overrides. Picking the
      // same value the group has means "lock me at this value" — that's
      // simpler than asking the user to think about inheritance.
      return {
        polishLevel:            this.f.polishLevel,
        tone:                   this.f.tone,
        sourceLanguageHint:     this.f.sourceLanguageHint, // null = auto-detect, fine to send as null
        voiceTranslate:         !!this.f.voiceTranslate,
        showSourceLabel:        !!this.f.showSourceLabel,
        showProcessingReaction: !!this.f.showProcessingReaction,
      };
    },

    async save() {
      this.busy = true;
      this.error = null;
      try {
        const token = tokenFromUrl();
        const resp = await fetch(api(`/api/u/${encodeURIComponent(token)}/me`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.formToOverrides()),
        });
        if (resp.status === 404) {
          this.state = 'expired';
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

    async resetAll() {
      this.busy = true;
      this.error = null;
      try {
        const token = tokenFromUrl();
        const resp = await fetch(api(`/api/u/${encodeURIComponent(token)}/me`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            polishLevel: null,
            tone: null,
            sourceLanguageHint: null,
            voiceTranslate: null,
            showSourceLabel: null,
            showProcessingReaction: null,
          }),
        });
        if (resp.status === 404) { this.state = 'expired'; return; }
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        // Re-fetch to sync the form back to the group defaults.
        const fresh = await fetch(api(`/api/u/${encodeURIComponent(token)}/me`));
        if (fresh.ok) this.applyServerState(await fresh.json());
        this.savedAt = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      } catch (err) {
        this.error = `Reset failed: ${err.message ?? err}`;
      } finally {
        this.busy = false;
      }
    },

    dismissIntro() {
      localStorage.setItem('ninjaSeenIntro', '1');
      this.showIntro = false;
    },
  };
}

window.userPage = userPage;
