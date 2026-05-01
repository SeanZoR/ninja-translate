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

    // Form state mirrors the API shape, with companion `*Inherit` flags.
    // When inherit is true, the override is sent as null (clear → inherit group).
    f: {
      polishLevel: 2,
      polishInherit: true,
      tone: 'neutral',
      toneInherit: true,
      sourceLanguageHint: null,
      hintInherit: true,
      voiceTranslate: true,
      voiceInherit: true,
      showSourceLabel: true,
      labelInherit: true,
      showProcessingReaction: false,
      reactionInherit: true,
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
      // For each setting, an override of `null` means "inherit". The form
      // shows the group default in that case so the user sees the current
      // effective value before they tweak.
      this.f.polishLevel              = o.polishLevel              ?? d.polishLevel              ?? 2;
      this.f.polishInherit            = o.polishLevel === null || o.polishLevel === undefined;
      this.f.tone                     = o.tone                     ?? d.tone                     ?? 'neutral';
      this.f.toneInherit              = o.tone === null || o.tone === undefined;
      this.f.sourceLanguageHint       = o.sourceLanguageHint       ?? d.sourceLanguageHint       ?? null;
      this.f.hintInherit              = o.sourceLanguageHint === null || o.sourceLanguageHint === undefined;
      this.f.voiceTranslate           = o.voiceTranslate           ?? d.voiceTranslate           ?? true;
      this.f.voiceInherit             = o.voiceTranslate === null || o.voiceTranslate === undefined;
      this.f.showSourceLabel          = o.showSourceLabel          ?? d.showSourceLabel          ?? true;
      this.f.labelInherit             = o.showSourceLabel === null || o.showSourceLabel === undefined;
      this.f.showProcessingReaction   = o.showProcessingReaction   ?? d.showProcessingReaction   ?? false;
      this.f.reactionInherit          = o.showProcessingReaction === null || o.showProcessingReaction === undefined;
    },

    formToOverrides() {
      return {
        polishLevel:            this.f.polishInherit   ? null : this.f.polishLevel,
        tone:                   this.f.toneInherit     ? null : this.f.tone,
        sourceLanguageHint:     this.f.hintInherit     ? null : this.f.sourceLanguageHint,
        voiceTranslate:         this.f.voiceInherit    ? null : !!this.f.voiceTranslate,
        showSourceLabel:        this.f.labelInherit    ? null : !!this.f.showSourceLabel,
        showProcessingReaction: this.f.reactionInherit ? null : !!this.f.showProcessingReaction,
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
        this.savedAt = new Date().toLocaleTimeString();
      } catch (err) {
        this.error = `Save failed: ${err.message ?? err}`;
      } finally {
        this.busy = false;
      }
    },

    async resetAll() {
      this.f.polishInherit = true;
      this.f.toneInherit = true;
      this.f.hintInherit = true;
      this.f.voiceInherit = true;
      this.f.labelInherit = true;
      this.f.reactionInherit = true;
      await this.save();
    },

    dismissIntro() {
      localStorage.setItem('ninjaSeenIntro', '1');
      this.showIntro = false;
    },
  };
}

window.userPage = userPage;
