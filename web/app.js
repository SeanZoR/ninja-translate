// API base URL: read from <meta name="api-base">. Defaults to same-origin for local dev.
const API_BASE = (() => {
  const meta = document.querySelector('meta[name="api-base"]');
  const v = meta?.getAttribute('content')?.trim();
  return v && v.length > 0 ? v.replace(/\/$/, '') : '';
})();

const api = (path) => `${API_BASE}${path}`;

// Always send the CF Access cookie when calling the API.
const J = (init = {}) => ({ credentials: 'include', ...init });

function app() {
  return {
    tab: 'inbox',
    botJid: null,
    serverNow: '',
    pending: [],
    groups: [],
    usage: {},
    forms: {},
    modal: null,
    current: null,
    settingsLanguagesText: '',
    messages: [],
    createForm: { subject: '', label: '', languagesText: '', seedJid: '' },
    createResult: null,

    async init() {
      await this.refresh();
      setInterval(() => this.refresh(), 10000);
    },

    async refresh() {
      const [sysR, inboxR, groupsR, usageR] = await Promise.all([
        fetch(api('/api/system'), J()).then(r => r.json()),
        fetch(api('/api/inbox'), J()).then(r => r.json()),
        fetch(api('/api/groups'), J()).then(r => r.json()),
        fetch(api('/api/usage/this-month'), J()).then(r => r.json()),
      ]);
      this.botJid = sysR.botJid;
      this.serverNow = sysR.now;
      this.pending = inboxR.pending || [];
      this.groups = groupsR.groups || [];
      this.usage = usageR;

      for (const p of this.pending) {
        if (!this.forms[p.jid]) {
          this.forms[p.jid] = {
            label: p.subject || '',
            languagesText: '',
            conciseMode: false,
            showSourceLabel: true,
            showProcessingReaction: false,
            maxAudioSeconds: 120,
            monthlyBudgetCents: 500,
            notes: '',
          };
        }
      }
    },

    async approve(p) {
      const f = this.forms[p.jid];
      const target = f.languagesText.split(',').map(s => s.trim()).filter(Boolean);
      if (target.length === 0) return alert('Enter at least one language code (e.g., en,th)');
      const res = await fetch(api('/api/inbox/' + encodeURIComponent(p.jid) + '/approve'), J({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          label: f.label,
          targetLanguages: target,
          conciseMode: f.conciseMode,
          showSourceLabel: f.showSourceLabel,
          showProcessingReaction: f.showProcessingReaction,
          maxAudioSeconds: f.maxAudioSeconds,
          monthlyBudgetCents: f.monthlyBudgetCents,
          notes: f.notes || null,
        }),
      }));
      if (!res.ok) return alert('Approve failed: ' + (await res.text()));
      await this.refresh();
    },

    async reject(p) {
      if (!confirm('Reject ' + (p.subject || p.jid) + ' and leave the group?')) return;
      const res = await fetch(api('/api/inbox/' + encodeURIComponent(p.jid) + '/reject'), J({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }));
      if (!res.ok) return alert('Reject failed: ' + (await res.text()));
      await this.refresh();
    },

    async dismissPending(p) {
      await fetch(api('/api/inbox/' + encodeURIComponent(p.jid)), J({ method: 'DELETE' }));
      await this.refresh();
    },

    async toggleEnabled(g, enabled) {
      g.enabled = enabled;
      await this.saveGroup(g);
    },

    async saveGroup(g) {
      const res = await fetch(api('/api/groups/' + encodeURIComponent(g.jid)), J({
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(g),
      }));
      if (!res.ok) alert('Save failed: ' + (await res.text()));
    },

    openSettings(g) {
      this.current = JSON.parse(JSON.stringify(g));
      this.settingsLanguagesText = this.current.targetLanguages.join(',');
      this.modal = 'settings';
    },

    async saveSettings() {
      this.current.targetLanguages = this.settingsLanguagesText
        .split(',').map(s => s.trim()).filter(Boolean);
      await this.saveGroup(this.current);
      this.modal = null;
      await this.refresh();
    },

    async regenerate() {
      if (!confirm('Regenerate invite link? The old one will stop working.')) return;
      const res = await fetch(
        api('/api/groups/' + encodeURIComponent(this.current.jid) + '/regenerate-invite'),
        J({ method: 'POST' }),
      );
      const j = await res.json();
      this.current.inviteLink = j.inviteLink;
    },

    async leave(g) {
      if (!confirm('Leave ' + g.label + '? The group stays in WhatsApp without the bot, and is removed from the allowlist.')) return;
      const res = await fetch(
        api('/api/groups/' + encodeURIComponent(g.jid) + '?leave=true'),
        J({ method: 'DELETE' }),
      );
      if (!res.ok) return alert('Leave failed: ' + (await res.text()));
      await this.refresh();
    },

    async openHistory(g) {
      this.current = g;
      const res = await fetch(
        api('/api/messages/' + encodeURIComponent(g.jid) + '?limit=100'),
        J(),
      );
      const j = await res.json();
      this.messages = j.messages || [];
      this.modal = 'history';
    },

    async createGroup() {
      const langs = this.createForm.languagesText.split(',').map(s => s.trim()).filter(Boolean);
      if (!langs.length) return alert('Enter at least one language');
      const res = await fetch(api('/api/groups/create'), J({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subject: this.createForm.subject,
          label: this.createForm.label,
          targetLanguages: langs,
          seedJid: this.createForm.seedJid,
          seedShouldLeaveAfter: true,
        }),
      }));
      if (!res.ok) return alert('Create failed: ' + (await res.text()));
      this.createResult = await res.json();
      await this.refresh();
    },

    formatCents(c) {
      if (typeof c !== 'number') return '-';
      return '¢' + c.toFixed(2);
    },

    labelFor(jid) {
      const g = this.groups.find(g => g.jid === jid);
      return g ? g.label : '';
    },
  };
}
