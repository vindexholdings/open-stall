import { signIn } from './actions';

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="wrap">
      <h1>Admin sign-in</h1>
      <p className="muted">Administrators only. A second factor is required after signing in.</p>
      {error ? <p role="alert">{error.slice(0, 200)}</p> : null}
      <form action={signIn}>
        <label>Email <input name="email" type="email" autoComplete="username" required /></label>
        <label>Password <input name="password" type="password" autoComplete="current-password" required /></label>
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
