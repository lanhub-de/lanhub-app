// Emails the platform sends itself (sign-in emails come from Supabase).
// Sent through Resend with the school's domain; needs RESEND_API_KEY on the server.
const SITE = process.env.SITE_URL || 'https://lanhub-app.onrender.com';
const FROM = 'LanHub <noreply@lanhub.academy>';

const ROLE = {
  en: { owner: 'owner', head_teacher: 'head teacher', manager: 'manager', teacher: 'teacher', student: 'student' },
  uk: { owner: 'власниця', head_teacher: 'керівник навчання', manager: 'менеджер', teacher: 'викладач', student: 'студент' },
} as const;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function canSendMail() {
  return Boolean(process.env.RESEND_API_KEY);
}

export async function sendInvite(to: string, name: string, role: string, locale: string): Promise<string | null> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return 'RESEND_API_KEY is not set';
  const uk = locale === 'uk';
  const roleName = (uk ? ROLE.uk : ROLE.en)[role as keyof typeof ROLE.en] ?? role;
  const t = uk
    ? {
      subject: 'Запрошення до LanHub',
      hi: `Привіт, ${esc(name)}!`,
      body: `Тебе додали до платформи LanHub (роль: ${roleName}). Натисни кнопку і увійди з цією поштою: ${esc(to)}. Пароль не потрібен, ми надішлемо лист із кнопкою і кодом для входу.`,
      button: 'Відкрити LanHub',
      tip: 'Порада: збережи LanHub на телефоні чи комп’ютері як застосунок, щоб відкривати його одним натисканням.',
    }
    : {
      subject: 'Your invitation to LanHub',
      hi: `Hi ${esc(name)}!`,
      body: `You have been added to the LanHub platform as ${roleName}. Click the button and sign in with this email address: ${esc(to)}. No password needed: we will send you an email with a sign-in button and a code.`,
      button: 'Open LanHub',
      tip: 'Tip: add LanHub to your phone or computer as an app, so it opens with one tap.',
    };
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f1a17">
  <p style="font-size:22px;font-weight:700;color:#a30000;margin:0 0 20px">LanHub</p>
  <p style="font-size:16px;font-weight:700;margin:0 0 10px">${t.hi}</p>
  <p style="font-size:16px;line-height:1.5;margin:0 0 22px">${t.body}</p>
  <p style="margin:0 0 24px"><a href="${SITE}/login${uk ? '?lang=uk' : ''}" style="display:inline-block;background:#a30000;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:10px">${t.button}</a></p>
  <p style="font-size:13px;color:#6b625b;margin:0">${t.tip}</p>
</div>`;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject: t.subject, html }),
    });
    if (!r.ok) return `Resend: ${r.status} ${(await r.text()).slice(0, 200)}`;
    return null;
  } catch (e) {
    return String(e);
  }
}

// A student's invitation: her lessons, Zoom, homework and the chat with her
// teacher in one place. She signs in with this email (the card's email).
export async function sendStudentInvite(to: string, name: string, teacher: string | null, locale: string): Promise<string | null> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return 'RESEND_API_KEY is not set';
  const uk = locale === 'uk';
  const first = esc(name.split(' ')[0]);
  const t = uk
    ? {
      subject: 'Твій кабінет у LanHub',
      hi: `Привіт, ${first}!`,
      body: `${teacher ? `${esc(teacher)} запрошує` : 'Запрошуємо'} тебе в LanHub. Тут твої заняття і посилання на Zoom, матеріали, домашні завдання і чат із викладачкою, все в одному місці.`,
      how: `Натисни кнопку і увійди з цією поштою: <b>${esc(to)}</b>. Пароль не потрібен: ми надішлемо лист із кодом для входу.`,
      button: 'Відкрити LanHub',
      tip: 'Порада: збережи LanHub на телефоні чи комп’ютері як застосунок і увімкни сповіщення, щоб не пропускати повідомлення.',
    }
    : {
      subject: 'Your LanHub space',
      hi: `Hi ${first}!`,
      body: `${teacher ? `${esc(teacher)} invites` : 'We invite'} you to LanHub: your lessons and Zoom links, materials, homework and the chat with your teacher, all in one place.`,
      how: `Click the button and sign in with this email address: <b>${esc(to)}</b>. No password needed: we will send you an email with a sign-in code.`,
      button: 'Open LanHub',
      tip: 'Tip: add LanHub to your phone or computer as an app and turn on notifications, so you never miss a message.',
    };
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f1a17">
  <p style="font-size:22px;font-weight:700;color:#a30000;margin:0 0 20px">LanHub</p>
  <p style="font-size:16px;font-weight:700;margin:0 0 10px">${t.hi}</p>
  <p style="font-size:16px;line-height:1.5;margin:0 0 12px">${t.body}</p>
  <p style="font-size:16px;line-height:1.5;margin:0 0 22px">${t.how}</p>
  <p style="margin:0 0 24px"><a href="${SITE}/login${uk ? '?lang=uk' : ''}" style="display:inline-block;background:#a30000;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:10px">${t.button}</a></p>
  <p style="font-size:13px;color:#6b625b;margin:0">${t.tip}</p>
</div>`;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject: t.subject, html }),
    });
    if (!r.ok) return `Resend: ${r.status} ${(await r.text()).slice(0, 200)}`;
    return null;
  } catch (e) {
    return String(e);
  }
}

// "You have a new message" for people without notifications switched on.
export async function sendChatNotice(
  to: string, name: string, locale: string, from: string, chat: string, snippet: string, path: string,
): Promise<string | null> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return 'RESEND_API_KEY is not set';
  const uk = locale === 'uk';
  const t = uk
    ? { subject: `Нове повідомлення в LanHub: ${from}`, hi: `Привіт, ${esc(name)}!`, body: `${esc(from)} написав(-ла) тобі${chat ? ` у чаті «${esc(chat)}»` : ''}:`, button: 'Відповісти в LanHub', tip: 'Увімкни сповіщення в чаті LanHub, і нові повідомлення приходитимуть одразу на телефон чи комп’ютер.' }
    : { subject: `New message in LanHub from ${from}`, hi: `Hi ${esc(name)}!`, body: `${esc(from)} wrote to you${chat ? ` in “${esc(chat)}”` : ''}:`, button: 'Reply in LanHub', tip: 'Switch on notifications in the LanHub chat to get new messages on your phone or computer at once.' };
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f1a17">
  <p style="font-size:22px;font-weight:700;color:#a30000;margin:0 0 20px">LanHub</p>
  <p style="font-size:16px;font-weight:700;margin:0 0 10px">${t.hi}</p>
  <p style="font-size:16px;line-height:1.5;margin:0 0 10px">${t.body}</p>
  <p style="font-size:16px;line-height:1.5;margin:0 0 22px;padding:12px 14px;background:#f5efe8;border-radius:10px">${esc(snippet)}</p>
  <p style="margin:0 0 24px"><a href="${SITE}${path}" style="display:inline-block;background:#a30000;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 28px;border-radius:10px">${t.button}</a></p>
  <p style="font-size:13px;color:#6b625b;margin:0">${t.tip}</p>
</div>`;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [to], subject: t.subject, html }),
    });
    if (!r.ok) return `Resend: ${r.status} ${(await r.text()).slice(0, 200)}`;
    return null;
  } catch (e) {
    return String(e);
  }
}
