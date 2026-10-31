import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// A Supabase client acting as the signed-in person. Every query goes through
// the database access rules for that person's role.
export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a server component: the middleware refreshes cookies instead.
          }
        },
      },
    },
  );
}
