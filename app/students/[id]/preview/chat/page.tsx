import Link from 'next/link';
import StudentShell from '@/components/StudentShell';
import { requireProfile } from '@/lib/session';
import { loadPreview } from '@/lib/studentPreview';
import { chatWith } from '@/lib/names';

type Msg = { id: string; sender_id: string; body: string | null; file_kind: string | null; file_name: string | null };

// The student's chats as she sees them, to read only: the chat with her
// teacher and her groups' chats.
export default async function StudentPreviewChat({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, profile, t } = await requireProfile(['owner', 'head_teacher', 'manager', 'teacher']);
  const { id } = await params;
  const p = await loadPreview(supabase, profile, t, id);
  const [{ data: teacherRows }, { data: direct }] = await Promise.all([
    supabase.rpc('student_teacher', { sid: id }),
    supabase.from('conversations').select('id').eq('kind', 'direct').eq('student_id', id).limit(1).maybeSingle(),
  ]);
  const teacher = ((teacherRows ?? []) as { teacher_id: string | null; teacher_name: string | null; can_chat: boolean }[])[0];
  const cid = (direct as { id: string } | null)?.id ?? null;
  const { data: msgs } = cid
    ? await supabase.from('messages').select('id, sender_id, body, file_kind, file_name').eq('conversation_id', cid)
      .order('created_at', { ascending: false }).limit(40)
    : { data: [] as Msg[] };
  const list = ((msgs ?? []) as Msg[]).reverse();
  const tName = teacher?.teacher_name ?? '';
  return (
    <StudentShell t={t} locale={profile.locale} name={p.name} active="/chat" preview={p.frame}>
      <div className="s-narrow">
        <h1 className="s-title">{t('navChatOne')}</h1>
        <section className="card s-card s-chat">
          <div className="spread">
            <h2 className="s-h">{tName ? chatWith(tName, profile.locale) : t('schoolChat')}</h2>
            {cid && <Link href={`/chat?c=${cid}`} className="small-link">{t('openInChats')}</Link>}
          </div>
          {list.length === 0 && (
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>
              {teacher?.can_chat ? t('chatEmpty') : t('chatAfterSignIn', { name: tName.split(' ')[0] || t('teacherWord') })}
            </p>
          )}
          {list.map((m) => (
            <div key={m.id} className={`s-bubble ${m.sender_id === teacher?.teacher_id ? '' : 'mine'}`}>
              {m.body ?? (m.file_kind === 'audio' ? '🎤' : `📎 ${m.file_name ?? ''}`)}
            </div>
          ))}
        </section>
        {p.groups.map((g) => (
          <Link key={g.id} href={`/chat?g=${g.id}`} className="card s-row" style={{ padding: '0 20px' }}>
            <span>💬 {t('chatKindGroup')} · {g.name}</span><span className="open-link">{t('open')}</span>
          </Link>
        ))}
      </div>
    </StudentShell>
  );
}
