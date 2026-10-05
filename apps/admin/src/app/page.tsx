import Link from 'next/link';

export default function AdminHome() {
  return (
    <main className="wrap">
      <h1>Open Stall Admin</h1>
      <p className="muted">Sign-in and full moderation tools are not enabled yet.</p>
      <p><Link href="/review">Validate seeded locations</Link> (local machine only)</p>
    </main>
  );
}
