# Device evidence record: iPhone 13 Pro, VoiceOver (OWNER-OBSERVED, OLDER BUILD)

Source of truth for the wording is `MOBILE_QA.md` section 2c. This file is the per-device record the results template (section 8) points to.

- Observed by: Jake (owner), reported in the Work oversight chat. Not automated; not independently tested by Work or Claude.
- Device / OS: iPhone 13 Pro, iOS 26.6.2 (owner-reported). Runtime: Expo Go.
- Statement: "I successfully launched Open Stall on my physical iPhone through Expo Go. The app functions correctly, and I tested VoiceOver successfully."
- Served from: `~/open-stall` via `npm run start -w @open-stall/mobile` (Expo reported `~/open-stall/apps/mobile`). Work read-only verification: HEAD `fb4b65d3dba7db7382b2b89257aebeb1cea70f10`, no tracked mobile or shared source diff (modified `package-lock.json`, untracked local files). This is the source checkout, not a captured on-device bundle hash.
- Build: predates the accepted R1-R4 redesign. **Not evidence for the redesigned UI.**
- Backend / fixture: not supplied. Per-journey and per-item coverage: not itemized (do not infer).
- Android / TalkBack: NOT RUN.

## Still to record for the redesigned build (iPhone)
Launch from a separate clean `claude-local` checkout against the local mock, then fill in per item: WebView/map, session lifecycle, permissions/GPS, OS large text, keyboard and safe areas, failure and recovery, spoken labels and focus, for the five journeys. Use the section 8 template of `MOBILE_QA.md`.
