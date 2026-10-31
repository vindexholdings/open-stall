import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/** Keeps the admin session cookies fresh for the sign-in, MFA, queue and seeded-location review routes. */
export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let response = NextResponse.next({ request });
  if (!url || !key) return response;
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (all) => {
        for (const c of all) request.cookies.set(c.name, c.value);
        response = NextResponse.next({ request });
        for (const c of all) response.cookies.set(c.name, c.value, c.options);
      },
    },
  });
  await supabase.auth.getUser();
  return response;
}

export const config = { matcher: ['/signin', '/mfa', '/queue/:path*', '/queue', '/review/:path*', '/review'] };
