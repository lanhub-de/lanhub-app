import Link from 'next/link';
import { redirect } from 'next/navigation';
import Shell, { Flash } from '@/components/Shell';
import ChatRoom, { type ChatMessage } from '@/components/ChatRoom';
import PushToggle from '@/components/PushToggle';
import { requireProfile } from '@/lib/session';
import { openChat } from './actions';

type Chat = {
  id: string; kind: 'group' | 'direct' | 'school'; title: string; subtitle: string | null;
  group_id: string | null; student_id: string | null; teacher_id: string | null;
  last_message_at: string | null; last_body: string | null; unread: number; mine: boolean;
};

export default async function ChatPage({
  searchParams,
}: { searchParams: Promise<{ c?: string; g?: string; e?: string; all?: string }> }) {
  const { supabase, profile, t } = await requireProfile();
  const sp = await searchParams;

  // /chat?g=<group> opens that group's chat
  if (sp.g) {
    const { data, error } = await supabase.rpc('start_chat', { p_kind: 'group', p_group: sp.g });
    redirect(error ? `/chat?e=${encodeURIComponent(error.message)}` : `/chat?c=${data}`);
  }

  await supabase.rpc('ensure_my_chats');
  const { data } = await supabase.rpc('my_chats');
  const chats = (data ?? []) as Chat[];
  const canOversee = profile.role === 'owner' || profile.role === 'head_teacher';
  const showAll = canOversee && sp.all === '1';
  const list = chats.filter((c) => (showAll ? !c.mine : c.mine));
  const current = chats.find((c) => c.id === sp.c) ?? null;
  const teaches = ['owner', 'head_teacher', 'teacher'].includes(profile.role);
  const school = profile.role === 'owner' || profile.role === 'manager';

  // the open chat
  let messages: ChatMessage[] = [];
  let people: Record<string, { name: string; role: string }> = {};
  let notice: string | null = null;
  if (current) {
    const [msgs, ppl] = await Promise.all([
      supabase.from('messages').select('id, conversation_id, sender_id, body, file_path, file_kind, file_name, created_at')
        .eq('conversation_id', current.id).order('created_at', { ascending: false }).limit(200),
      supabase.rpc('chat_people', { cid: current.id }),
    ]);
    messages = ((msgs.data ?? []) as ChatMessage[]).reverse();
    people = Object.fromEntries(((ppl.data ?? []) as { id: string; full_name: string; role: string }[])
      .map((p) => [p.id, { name: p.full_name, role: p.role }]));
    const paths = messages.map((m) => m.file_path).filter(Boolean) as string[];
    if (paths.length) {
      const { data: signed } = await supabase.storage.from('chat').createSignedUrls(paths, 3600);
      const urlOf = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));
      messages = messages.map((m) => (m.file_path ? { ...m, url: urlOf.get(m.file_path) ?? null } : m));
    }
    if (current.kind === 'school') notice = t('chatSchoolNotice');
    else notice = t('chatControlNotice');
    // in a group, say how many students can actually see the chat
    if (current.kind === 'group' && profile.role !== 'student' && current.group_id) {
      const { data: members } = await supabase.from('group_members')
        .select('students(profile_id)').eq('group_id', current.group_id)
        .returns<{ students: { profile_id: string | null } | null }[]>();
      const total = (members ?? []).length;
      const withLogin = (members ?? []).filter((m) => m.students?.profile_id).length;
      if (withLogin < total) notice = `${t('chatMembersIn', { n: withLogin, m: total })} ${notice}`;
    }
  }

  // people a teacher (or the school) can start a chat with
  const pickTeacher = teaches
    ? await (async () => {
      const [own, groups] = await Promise.all([
        supabase.from('students').select('id, full_name').eq('teacher_id', profile.id).eq('status', 'active').order('full_name'),
        supabase.from('groups').select('id, name, group_members(students(id, full_name))').eq('teacher_id', profile.id)
          .eq('active', true).is('pending_teacher', null)
          .returns<{ id: string; name: string; group_members: { students: { id: string; full_name: string } | null }[] }[]>(),
      ]);
      const map = new Map<string, string>();
      for (const s of own.data ?? []) map.set(s.id, s.full_name);
      for (const g of groups.data ?? []) for (const m of g.group_members) if (m.students) map.set(m.students.id, m.students.full_name);
      return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    })()
    : [];
  const pickSchool = school
    ? ((await supabase.from('students').select('id, full_name').eq('status', 'active').not('profile_id', 'is', null).order('full_name')).data ?? [])
    : [];

  const labels = {
    placeholder: t('chatPlaceholder'), send: t('chatSend'), attach: t('chatAttach'), voice: t('chatVoice'),
    recording: t('chatRecording'), cancel: t('cancel'), you: t('chatYou'), empty: t('chatEmpty'),
    tooBig: t('chatTooBig'), failed: t('chatFailed'), noMic: t('chatNoMic'), remove: t('chatRemove'), today: t('c_today'),
  };
  const kindLabel = (c: Chat) => t(c.kind === 'group' ? 'chatKindGroup' : c.kind === 'school' ? 'chatKindSchool' : 'chatKindDirect');

  return (
    <Shell profile={profile} t={t} active="/chat">
      <Flash error={sp.e} />
      <div className={`chat-wrap ${current ? 'has-current' : ''}`}>
        <aside className="chat-list card">
          <div className="spread" style={{ marginBottom: 8 }}>
            <h1 style={{ fontSize: 22, margin: 0 }}>{t('navChat')}</h1>
            {canOversee && (
              <Link href={showAll ? '/chat' : '/chat?all=1'} className="small-link">{showAll ? t('chatMine') : t('chatAll')}</Link>
            )}
          </div>
          <PushToggle labels={{ on: t('notifyOn'), hint: t('notifyHint'), done: t('notifyDone'), denied: t('notifyDenied'), ios: t('notifyIos') }} />
          {list.length === 0 && <p className="muted">{t('chatNone')}</p>}
          {list.map((c) => (
            <Link key={c.id} href={`/chat?c=${c.id}${showAll ? '&all=1' : ''}`} className={`chat-item ${current?.id === c.id ? 'active' : ''}`}>
              <span className={`chat-avatar k-${c.kind}`} aria-hidden="true">{c.kind === 'group' ? '👥' : c.kind === 'school' ? 'L' : c.title.charAt(0).toUpperCase()}</span>
              <span className="chat-item-main">
                <span className="chat-item-top">
                  <strong>{c.title}</strong>
                  {c.unread > 0 && <span className="badge">{c.unread}</span>}
                </span>
                <span className="chat-item-sub">{c.last_body || kindLabel(c)}</span>
              </span>
            </Link>
          ))}

          {pickTeacher.length > 0 && (
            <form action={openChat} className="stack chat-start">
              <input type="hidden" name="kind" value="direct" />
              <input type="hidden" name="teacher_id" value={profile.id} />
              <label>{t('chatWriteStudent')}
                <select name="student_id" required defaultValue="">
                  <option value="" disabled>…</option>
                  {pickTeacher.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              </label>
              <button className="small" type="submit">{t('chatOpen')}</button>
            </form>
          )}
          {pickSchool.length > 0 && (
            <form action={openChat} className="stack chat-start">
              <input type="hidden" name="kind" value="school" />
              <label>{t('chatWriteAsSchool')}
                <select name="student_id" required defaultValue="">
                  <option value="" disabled>…</option>
                  {pickSchool.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              </label>
              <button className="small" type="submit">{t('chatOpen')}</button>
            </form>
          )}
        </aside>

        <section className="chat-main card">
          {current ? (
            <>
              <div className="chat-head">
                <Link href={showAll ? '/chat?all=1' : '/chat'} className="chat-back" aria-label={t('back')}>←</Link>
                <div>
                  <strong style={{ fontSize: 17 }}>{current.title}</strong>
                  <div className="muted" style={{ fontSize: 13 }}>{kindLabel(current)}{current.subtitle ? ` · ${t('studentsN', { n: current.subtitle })}` : ''}</div>
                </div>
                {current.kind === 'group' && current.group_id && profile.role !== 'student' && (
                  <Link href={`/groups/${current.group_id}`} className="btn small" style={{ marginLeft: 'auto' }}>{t('navGroups')}</Link>
                )}
              </div>
              <ChatRoom key={current.id} cid={current.id} me={profile.id} people={people} initial={messages}
                labels={labels} locale={profile.locale} showNames={current.kind !== 'direct' || !current.mine} notice={notice} />
            </>
          ) : (
            <div className="chat-pick muted">{t('chatPick')}</div>
          )}
        </section>
      </div>
    </Shell>
  );
}
