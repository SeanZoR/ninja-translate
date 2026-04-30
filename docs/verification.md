# Verification Runbook

End-to-end verification for ninja-translate. Three layers, smallest blast
radius first:

1. **Local playground** — exercises the translator end-to-end with no
   WhatsApp involved.
2. **Local Hono integration** — exercises the API + DB + admin flows with no
   WhatsApp involved.
3. **Live WhatsApp smoke test** — real bot, real WhatsApp, real group.

Run them in order. Don't move on until the prior layer is clean.

## Layer 1: Playground (no WhatsApp)

The Playground tab in the dashboard hits `POST /api/playground/translate`
which calls Gemini directly without persisting or sending. Use it to tune
languages, flags, and verify per-language quality.

### 1.1 Boot admin-only mode

```bash
cd path/to/ninja-translate
pnpm dev:admin
# admin API on http://127.0.0.1:7878
```

Make sure `GEMINI_API_KEY` is set in your `.env` (or injected by your secret
manager) — the Playground will fail without it.

In a second terminal serve the dashboard. Easiest local-dev path:

```bash
cd path/to/ninja-translate/web
# Hand-edit web/index.html temporarily so the dashboard hits the local API:
#   <meta name="api-base" content="http://127.0.0.1:7878" />
# Don't commit that change.
python3 -m http.server 5173
# open http://127.0.0.1:5173
```

### 1.2 Text-mode smoke

In the **Playground** tab:

| # | Languages | Input text | Expected |
|---|---|---|---|
| 1 | `en,th` | `"Please warm the milk and bring it upstairs"` | Detected `en`, Thai translation rendered with the country flag. |
| 2 | `en,th,he` | (Hebrew) `"לתת לילד לישון"` | Detected `he`, English + Thai translations. |
| 3 | `en,th,my` | (Burmese) any short phrase | Detected `my`, English + Thai translations. **Burmese quality gate.** If output is garbled, switch to the ElevenLabs+Anthropic fallback before going further. |
| 4 | `en,th` (polishLevel=2) | Voice note: English with several "um/uh/like" fillers and a false start | Source line shows a cleaned-up version (no fillers); Thai translation reflects the cleaned text. |
| 5 | `en,th` (polishLevel=0) | Same voice note as #4 | Source line is fully verbatim — fillers and false starts preserved. |

Record per-message the rendered string, the detected language, and the cost.
A 3-language voice-style message should land at well under ¢0.1.

### 1.3 Voice-mode smoke

Click **Record** in the Playground (or upload an audio file). Run the same
matrix as 1.2, with you speaking the language being tested. Hold each clip
to ~5–15 seconds. Expected reply latency ~2–4s.

**Burmese quality gate is mandatory** before going to Layer 3. Either:

- Record 5 short Burmese phrases yourself (or with a Burmese-speaking
  contact), or
- Source 5 short public-domain Burmese clips for offline testing.

If 4/5 Burmese transcriptions are wrong or wildly off, stop and switch the
translator to the ElevenLabs Scribe + Anthropic path before continuing.

### 1.4 Parser robustness

Run the same input twice with different `polishLevel` values (0 vs 2 vs 3)
and confirm the parser handles every shape — the rendered source line should
reflect the polishing instruction, and the `translations` JSON should always
have one key per non-source target language.

## Layer 2: Local Hono integration (no WhatsApp)

Run `pnpm dev:admin` and exercise the admin API directly with `curl` or by
clicking through the dashboard. WhatsApp side stays mocked; pretend group
JIDs and messages are inserted manually via SQLite.

### 2.1 Allowlist round-trip

```bash
# Create a group manually
curl -X PUT http://127.0.0.1:7878/api/groups/120363999999999999@g.us \
  -H 'content-type: application/json' \
  -d '{
    "jid": "120363999999999999@g.us",
    "label": "Test family (en/th)",
    "targetLanguages": ["en", "th"],
    "enabled": true,
    "voiceTranslate": true,
    "textTranslateOnMention": true,
    "polishLevel": 1,
    "showSourceLabel": true,
    "showProcessingReaction": false,
    "maxAudioSeconds": 600,
    "monthlyBudgetCents": 500,
    "createdByNinja": false,
    "inviteLink": null,
    "notes": null
  }'

# List
curl http://127.0.0.1:7878/api/groups | jq
# Update one field
curl -X PUT http://127.0.0.1:7878/api/groups/120363999999999999@g.us \
  -H 'content-type: application/json' \
  -d '{ ... same body, polishLevel: 2 }'
# Delete
curl -X DELETE 'http://127.0.0.1:7878/api/groups/120363999999999999@g.us'
```

Open the dashboard between calls — rows should appear/update/disappear
without manual refresh (10s polling).

### 2.2 Pending-groups inbox

Insert a pending row by hand to simulate "bot was added to a group":

```bash
sqlite3 ~/.ninja-translate/data.db <<'SQL'
INSERT INTO pending_groups (jid, subject, participants, inviter_jid, inviter_name, sample_messages)
VALUES (
  '120363111111111111@g.us',
  'Smith family + Mya',
  '["15550000001@s.whatsapp.net","9595xxxxxxx@s.whatsapp.net"]',
  '15550000001@s.whatsapp.net',
  'Mr. Smith',
  '[{"at":"2026-04-28T10:00:00Z","senderName":"Mr. Smith","senderJid":"15550000001@s.whatsapp.net","snippet":"hello"}]'
);
SQL
```

Open dashboard **Inbox** — card should appear. Click **Approve** with
`en,my` — row moves into `groups`. Click **Reject** on another inserted
pending row — row moves into `rejected_groups`. (The leave call to Baileys
will fail in admin-only mode; that's fine for this layer — the DB transition
is what we're testing.)

### 2.3 Cost tracking

Insert a synthetic message via SQLite:

```bash
sqlite3 ~/.ninja-translate/data.db <<'SQL'
INSERT INTO messages (group_jid, wa_message_id, sender_jid, sender_name, kind, source_lang, source_text, translations, audio_seconds, gemini_tokens_in, gemini_tokens_out, cost_cents)
VALUES ('120363999999999999@g.us', 'TEST_MSG_001', '15550000001@s.whatsapp.net', 'Tester', 'voice', 'th', 'สวัสดี', '{"en":"Hello"}', 6, 200, 50, 0.0123);

INSERT INTO usage_daily (group_jid, date, messages_count, audio_seconds_total, cost_cents_total)
VALUES ('120363999999999999@g.us', date('now'), 1, 6, 0.0123)
ON CONFLICT DO UPDATE SET messages_count = messages_count + 1, audio_seconds_total = audio_seconds_total + 6, cost_cents_total = cost_cents_total + 0.0123;
SQL
```

Verify in **Cost** tab — this group shows ¢0.012.

## Layer 3: Live WhatsApp smoke test

Now we're putting real messages through the real bot. **Do this only after
Layers 1 + 2 are clean.**

### 3.1 Setup

- Bot is running on a VPS (or locally), paired with a dedicated WA number.
- A second logged-in WhatsApp account is available for sending test messages
  (your personal WhatsApp Web works).
- A test group exists in WhatsApp containing the bot account and the test
  account. Just two participants is enough.

### 3.2 Discovery flow

1. From the test group, send any text message ("ping").
2. Within ~5 seconds, in the dashboard **Inbox**: a card should appear with
   subject = the test group name, inviter = your test account JID, sample
   messages including "ping".
3. Click **Approve**, label "Self-test (en/th/he)", languages `en,th,he`.
4. Card disappears from Inbox; group appears in **Groups**.

**Pass criteria**: card appeared with correct subject + inviter + sample
message; approval moves the group into the allowlist.

### 3.3 Voice translation

5. From your personal WhatsApp account, record a ~5-second voice message
   in **Hebrew** (e.g., "שלום, אני בוחן את הבוט").
6. Bot replies (in the same group, quoting your voice note) within ~5 seconds.
7. Expected reply shape:
   ```
   [lang: he]
   שלום, אני בוחן את הבוט
   ---
   🇬🇧 Hello, I'm testing the bot
   🇹🇭 สวัสดี ฉันกำลังทดสอบบอท
   ```
8. Repeat with **Thai** ("ฉันกำลังลองใช้บอท") and **English**
   ("Hello from English").

**Pass criteria**: 3/3 voice notes get correct transcripts and accurate
translations into the other two languages within ~5 seconds. Quoting the
original message correctly.

### 3.4 Text @mention

9. Send a text message in the group with `@<bot phone number>` mention.
   WhatsApp does mentions via `@` + selecting the contact.
10. Bot replies with translations; text @mentions never include the source
    line (the user already sees their own message above the bot's quoted
    reply). `polishLevel` is ignored on text input.
11. Send the same text WITHOUT mentioning the bot. Bot should stay silent.

**Pass criteria**: bot replies only when actually mentioned (via
`mentionedJid`, NOT text-parsed `@`).

### 3.5 Pre-flight cost guard

12. Record (or fake) an 11-minute voice message. Default
    `max_audio_seconds=600`, so this should be skipped.
13. Bot reacts with ⏱️ on the message; no reply text; no row in `messages`
    table.

**Pass criteria**: long voice gets the clock reaction and no Gemini call.

### 3.6 Budget cap

14. In the dashboard, set the test group's `monthlyBudgetCents` to `1`.
15. Send any voice message in the group.
16. Bot reacts with 💸 (or whatever the budget reaction emoji is set to);
    no translation reply.
17. Reset `monthlyBudgetCents` back to 500. Next message should translate
    normally.

**Pass criteria**: budget enforcement actually pauses the bot in that group,
then resumes when raised.

### 3.7 Rejection + re-add lockout

18. Add a fresh test group "Rejected test" with the bot.
19. From dashboard Inbox, click **Reject + Leave**.
20. Verify the bot leaves the group on the WhatsApp side.
21. Add the bot back to the SAME group.
22. Bot should NOT reappear in Inbox; row in `rejected_groups` keeps it out.

**Pass criteria**: bot leaves cleanly; re-adds from a rejected group are
silently ignored.

### 3.8 Persistence + dashboard alignment

23. Open **Group history** for the test group. Every translated message
    from 3.3–3.6 should be there with correct source_lang / source_text /
    translations / cost.
24. Open **Cost** tab. Test group's row should show this month's accumulated
    cents.

### 3.9 Resilience

25. SSH to VPS and `systemctl restart ninja-translate`.
26. Within ~10s, dashboard System tab shows `botJid` again (reconnected,
    not re-paired).
27. Send another voice in the test group → still works.

**Pass criteria**: zero re-pairing on restart; session resumes from
`wa-session/` files.

### 3.10 48-hour soak

Leave the bot up for 48 hours. Send a few messages a day. Expected: zero
WhatsApp disconnects (host IP not banned). If you see a disconnect, log the
timestamp — you may need to fall back to a SOCKS5 proxy or a different host.

## Sign-off

Don't move ninja-translate to friends/family until 3.1–3.9 all pass and
3.10 has 24h+ of clean uptime.
