import Link from 'next/link';

export default function AdminHome() {
  return (
    <main className="wrap">
      <h1>Open Stall Admin</h1>
      <p className="muted">Administrators sign in with their own account plus a second factor. Hosting is not enabled yet; run locally.</p>
      <p><Link href="/signin">Admin sign-in</Link> · <Link href="/queue">Review queue</Link></p>
      <p><Link href="/review">Validate seeded locations</Link> (local machine only)</p>
    </main>
  );
}
