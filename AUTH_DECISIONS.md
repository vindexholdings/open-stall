# Auth decisions

## OS-202 Yahoo sign-in: evaluated, DEFERRED (not in v1)
PRD: "Evaluate Yahoo SSO before implementing if disproportionate complexity."
- Supabase Auth has no built-in Yahoo provider (built-ins include Google, Apple, Facebook, GitHub and others). Yahoo would need a custom OIDC/OAuth bridge; whether the hosted plan supports that without a paid tier was not verifiable from this environment, so it could mean an Edge Function proxy or a paid plan.
- Extra cost of ownership: another developer app and consent screen to maintain, another provider failure mode, more account-linking edge cases (same email via different providers), and more privacy-policy and store-disclosure surface.
- Benefit: a small audience; Google + Apple + email already covers the large majority of US phone users. App Store rules only require Apple when other third-party sign-in is offered (we offer Google + Apple on iOS).
- Decision: do not build Yahoo now. Revisit after launch if sign-up friction data or user requests justify it; re-check Supabase custom-provider support and pricing at that time.

## Account-linking policy (applies to all providers)
Supabase links identities by verified email. Email sign-up requires confirmation, so an attacker cannot pre-register someone else's email and hijack a later Google/Apple sign-in. Keep "Confirm email" ON.

## Not enabled
Apple sign-in code exists but is skipped until the Apple Developer Program (paid) is approved; Apple is never shown on web or Android.
