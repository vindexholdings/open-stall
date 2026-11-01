# Account sign-in setup (OS-201)

The app signs in with Supabase Auth: email + password, Google (browser OAuth, PKCE) and Sign in with Apple (native iOS only). Restroom discovery never requires an account; favorites, ratings, check-ins, submissions, reports, profile and premium do (`requiresAuth()` in packages/domain, `RequireAuth` in the app).

Design notes
- Public values only in the app (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, already in `apps/mobile/.env.local`). Provider secrets live in the Supabase dashboard, never in the app or Git.
- Discovery uses a SEPARATE anonymous client, so restroom searches (precise location) are never tied to a signed-in identity. The account client persists the session (SecureStore on native, browser storage on web).
- PKCE only; return URLs must be `.../auth/callback` with a `code`; tokens in URLs are rejected; `next` redirects are internal paths only.
- Sign-in errors are generic (no account enumeration); password reset answers identically for any email.
- Admin authorization (OS-301) stays independent of this.

## One-time provider setup (owner actions)
See the checklist in the OS-201 hand-off message; summary:
1. Supabase, Authentication, URL Configuration: Site URL `http://localhost:8081` (replace at launch); add Redirect URLs `openstall://auth/callback`, `http://localhost:8081/auth/callback`, and (dev only, remove before launch) `exp://**/--/auth/callback`.
2. Supabase, Authentication, Sign In / Providers, Email: enabled, Confirm email ON, minimum password length 8.
3. Google: Google Cloud OAuth client (Web), redirect URI `https://xzzbcejgprilmolvdaes.supabase.co/auth/v1/callback`; paste Client ID/secret into Supabase, Providers, Google, enable. Free.
4. Apple (PAID: Apple Developer Program, about $99/year, needs your approval): enable Sign in with Apple on App ID `com.vindexholdings.openstall`; in Supabase, Providers, Apple, enable and set Client ID to the bundle id. Needs a native build (`npx expo run:ios`), not Expo Go.
5. Email delivery: the built-in Supabase mailer is rate-limited (fine for testing). Custom SMTP is a later, optional step.

## Testing order
Web first (email, then Google), then a native build for deep links and Apple. Expo Go uses `exp://` return URLs.
