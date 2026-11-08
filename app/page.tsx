import { redirect } from 'next/navigation';
import { requireProfile } from '@/lib/session';

// Everyone lands in their own cabinet.
export default async function Home() {
  const { profile } = await requireProfile();
  if (profile.role === 'teacher') redirect('/teacher');
  if (profile.role === 'student') redirect('/me');
  redirect('/school');
}
