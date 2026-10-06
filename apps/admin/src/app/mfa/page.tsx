import { redirect } from 'next/navigation';
import { sessionClient } from '@/lib/supabase/server';
import { EnrollForm } from './EnrollForm';
import { verifyCode } from './actions';

export default async function Mfa({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const supabase = await sessionClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) redirect('/signin');
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const verified = factors?.totp?.[0]; // listFactors().totp only contains verified TOTP factors

  return (
    <main className="wrap">
      <h1>Multi-factor verification</h1>
      {error ? <p role="alert">{error.slice(0, 200)}</p> : null}
      {verified ? (
        <form action={verifyCode}>
          <input type="hidden" name="factor" value={verified.id} />
          <label>6-digit code <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required /></label>
          <button type="submit">Verify</button>
        </form>
      ) : (
        <EnrollForm />
      )}
    </main>
  );
}
