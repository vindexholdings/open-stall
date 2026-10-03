import { colors, spacing } from '@open-stall/ui';

// Admin shell only. Supabase Auth + independent admin authorization arrive
// before any moderation data is exposed (SECURITY.md).
export default function AdminHome() {
  return (
    <main style={{ padding: spacing.xl, color: colors.text, background: colors.background, minHeight: '100vh' }}>
      <h1>Open Stall Admin</h1>
      <p style={{ color: colors.textMuted }}>Sign-in and moderation tools are not enabled yet.</p>
    </main>
  );
}
