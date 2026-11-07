// Interface text in Ukrainian and English. Content people write themselves
// (names, notes, materials) is never translated.
export type Locale = 'uk' | 'en';

const uk = {
  appName: 'LanHub',
  signIn: 'Вхід',
  emailLabel: 'Пошта',
  sendCode: 'Надіслати посилання для входу',
  codeSent: 'Ми надіслали лист на {email}. Відкрий його на цьому ж пристрої і в цьому ж браузері та натисни посилання в листі. Якщо листа немає, перевір «Спам».',
  linkFailed: 'Посилання не спрацювало. Відкрий лист у тому ж браузері, де вводила пошту, або надішли нове.',
  codeLabel: 'Код з листа',
  confirm: 'Увійти',
  otherEmail: 'Інша пошта',
  signOut: 'Вийти',
  noAccessTitle: 'Доступу поки немає',
  noAccessText: 'Цю пошту ще не додали в LanHub. Напиши школі, і тебе додадуть.',
  settings: 'Налаштування',
  language: 'Мова інтерфейсу',
  save: 'Зберегти',
  saved: 'Збережено',
  add: 'Додати',
  cancel: 'Скасувати',
  name: "Ім'я",
  level: 'Рівень',
  teacher: 'Викладач',
  student: 'Студент',
  date: 'Дата',
  time: 'Час',
  status: 'Статус',
  amount: 'Сума',
  note: 'Нотатка',
  open: 'Відкрити',
  nothingHere: 'Поки порожньо',
  // navigation
  navToday: 'Сьогодні',
  navOverview: 'Огляд',
  navStudents: 'Студенти',
  navLessons: 'Журнал занять',
  navPayouts: 'Оплати',
  navTeam: 'Команда',
  navLibrary: 'Бібліотека',
  // roles
  role_owner: 'власниця',
  role_head_teacher: 'керівник навчання',
  role_manager: 'менеджер',
  role_teacher: 'викладач',
  role_student: 'студент',
  // lesson kinds
  kind_individual: 'індивідуальне',
  kind_pair: 'пара',
  kind_group: 'група',
  kind_club: 'розмовний клуб',
  kind_trial: 'пробне',
  kind_diagnostic: 'діагностика',
  // statuses
  st_scheduled: 'заплановано',
  st_done: 'проведено',
  st_no_show: 'не прийшов',
  st_late_cancel: 'пізнє скасування',
  st_cancelled: 'скасовано вчасно',
  st_force_majeure: 'форс-мажор',
  st_rescheduled: 'перенесено',
  // teacher
  todayTitle: 'Мої заняття',
  needsMarking: 'Не відмічені',
  needsMarkingHint: 'Ці заняття вже минули. Відміть, як вони пройшли, від цього залежить оплата.',
  upcoming: 'Найближчі',
  markDone: 'Проведено',
  markOther: 'Інше',
  addLesson: 'Додати заняття',
  whoWith: 'З ким',
  zoomLink: 'Посилання на Zoom',
  myPay: 'Моя оплата за {month}',
  lessonsCount: 'занять',
  myStudents: 'Мої студенти',
  lessonsLeft: 'лишилось {n}',
  validUntil: 'діє до {date}',
  noPackage: 'немає активного пакета',
  // school
  notRenewed: 'Пакет закінчився, не продовжили',
  unmarkedOld: 'Не відмічені більше доби',
  payoutsMonth: 'До виплати викладачам за {month}',
  platformSchool: 'платформа школи',
  teacherCabinet: 'кабінет викладача',
  autoFromLog: 'Розрахунок зібрано з журналу занять автоматично',
  toPayTeachers: 'До виплати викладачам',
  teachersN: 'викладачів: {n}',
  awaitingReview: 'Розрахунки чекають перевірки',
  reviewHint: 'перевір і натисни «Виплачено»',
  exportCsv: 'Експорт у таблицю',
  ratesUah: 'Ставки, грн',
  sumUah: 'Сума, грн',
  needAttention: 'Потребують уваги',
  packageEndedHint: 'викладач {teacher} · пакет закінчився, нового немає',
  unmarkedHint: '{teacher} · заняття {date} не відмічене',
  allClear: 'Усе гаразд, нічого не чекає',
  noTeachersYet: 'Викладачів ще немає. Додай їх на сторінці «Команда».',
  groupsClub: 'групи, клуб',
  allDetails: 'Усі деталі',
  noLessonsYet: 'ще немає занять',
  addStudent: 'Додати студента',
  market: 'Ринок',
  market_ua: 'Україна',
  market_intl: 'міжнародний',
  contact: 'Telegram або телефон',
  packages: 'Пакети',
  addPackage: 'Додати пакет',
  lessonsTotal: 'Занять у пакеті',
  payment: 'Оплата студента',
  method: 'Спосіб',
  used: 'використано {used} з {total}',
  pkg_active: 'активний',
  pkg_finished: 'закінчився',
  pkg_expired: 'термін минув',
  pkg_cancelled: 'скасований',
  extraDays: 'Продовжено на {n} дн.',
  journal: 'Журнал занять',
  month: 'Місяць',
  allTeachers: 'Усі викладачі',
  payouts: 'Оплати викладачам',
  total: 'Разом',
  extraLine: 'Додатковий рядок (Zoom, GoodNotes, разова сума)',
  description: 'Опис',
  review_draft: 'чернетка',
  review_checked: 'перевірено',
  review_paid: 'виплачено',
  markChecked: 'Перевірено',
  markPaid: 'Виплачено',
  team: 'Команда',
  invite: 'Запросити',
  inviteHint: 'Людина входить з цієї пошти за посиланням з листа. Профіль створюється при першому вході.',
  ratesTemplate: 'Ставки',
  tpl_400: '400 / 420 / 460 (B1+: 420 за 8 занять, 460 за 12)',
  tpl_450: '450 / 520',
  tpl_550: '550 / 600',
  tpl_none: 'без ставок, внесу пізніше',
  pending: 'ще не входив(-ла)',
  rates: 'Ставки',
  addRate: 'Додати ставку',
  anyLevel: 'будь-який рівень',
  bandA: 'A0-A2',
  bandB: 'B1+',
  anyPackage: 'будь-який пакет',
  packageOf: 'пакет на {n}',
  validFrom: 'Діє з',
  // library
  library: 'Бібліотека',
  upload: 'Завантажити PDF',
  title: 'Назва',
  file: 'Файл',
  viewOnly: 'Лише перегляд, без скачування',
  showMode: 'Режим показу',
  exitShow: 'Вийти з показу',
  page: 'сторінка {n} з {total}',
  prev: 'Назад',
  next: 'Далі',
};

const en: typeof uk = {
  appName: 'LanHub',
  signIn: 'Sign in',
  emailLabel: 'Email',
  sendCode: 'Send sign-in link',
  codeSent: 'We sent an email to {email}. Open it on this device, in this browser, and click the link. No email? Check your spam folder.',
  linkFailed: 'The link did not work. Open the email in the same browser where you entered your email, or send a new one.',
  codeLabel: 'Code from the email',
  confirm: 'Sign in',
  otherEmail: 'Use another email',
  signOut: 'Sign out',
  noAccessTitle: 'No access yet',
  noAccessText: 'This email has not been added to LanHub yet. Message the school and they will add you.',
  settings: 'Settings',
  language: 'Interface language',
  save: 'Save',
  saved: 'Saved',
  add: 'Add',
  cancel: 'Cancel',
  name: 'Name',
  level: 'Level',
  teacher: 'Teacher',
  student: 'Student',
  date: 'Date',
  time: 'Time',
  status: 'Status',
  amount: 'Amount',
  note: 'Note',
  open: 'Open',
  nothingHere: 'Nothing here yet',
  navToday: 'Today',
  navOverview: 'Overview',
  navStudents: 'Students',
  navLessons: 'Lesson log',
  navPayouts: 'Payouts',
  navTeam: 'Team',
  navLibrary: 'Library',
  role_owner: 'owner',
  role_head_teacher: 'head teacher',
  role_manager: 'manager',
  role_teacher: 'teacher',
  role_student: 'student',
  kind_individual: 'one-to-one',
  kind_pair: 'pair',
  kind_group: 'group',
  kind_club: 'speaking club',
  kind_trial: 'trial',
  kind_diagnostic: 'level check',
  st_scheduled: 'scheduled',
  st_done: 'held',
  st_no_show: 'no-show',
  st_late_cancel: 'late cancellation',
  st_cancelled: 'cancelled in time',
  st_force_majeure: 'force majeure',
  st_rescheduled: 'rescheduled',
  todayTitle: 'My lessons',
  needsMarking: 'Not marked yet',
  needsMarkingHint: 'These lessons are over. Mark how they went: your pay depends on it.',
  upcoming: 'Upcoming',
  markDone: 'Held',
  markOther: 'Other',
  addLesson: 'Add lesson',
  whoWith: 'With',
  zoomLink: 'Zoom link',
  myPay: 'My pay for {month}',
  lessonsCount: 'lessons',
  myStudents: 'My students',
  lessonsLeft: '{n} left',
  validUntil: 'valid until {date}',
  noPackage: 'no active package',
  notRenewed: 'Package over, not renewed',
  unmarkedOld: 'Not marked for over a day',
  payoutsMonth: 'Teacher payouts for {month}',
  platformSchool: 'school platform',
  teacherCabinet: 'teacher cabinet',
  autoFromLog: 'Calculated automatically from the lesson log',
  toPayTeachers: 'To pay teachers',
  teachersN: 'teachers: {n}',
  awaitingReview: 'Payouts waiting for review',
  reviewHint: 'check them and press “Paid”',
  exportCsv: 'Export to spreadsheet',
  ratesUah: 'Rates, UAH',
  sumUah: 'Total, UAH',
  needAttention: 'Needs attention',
  packageEndedHint: 'teacher {teacher} · package ended, no new one',
  unmarkedHint: '{teacher} · lesson on {date} not marked',
  allClear: 'All clear, nothing waiting',
  noTeachersYet: 'No teachers yet. Add them on the Team page.',
  groupsClub: 'groups, club',
  allDetails: 'All details',
  noLessonsYet: 'no lessons yet',
  addStudent: 'Add student',
  market: 'Market',
  market_ua: 'Ukraine',
  market_intl: 'international',
  contact: 'Telegram or phone',
  packages: 'Packages',
  addPackage: 'Add package',
  lessonsTotal: 'Lessons in package',
  payment: 'Student payment',
  method: 'Method',
  used: '{used} of {total} used',
  pkg_active: 'active',
  pkg_finished: 'finished',
  pkg_expired: 'expired',
  pkg_cancelled: 'cancelled',
  extraDays: 'Extended by {n} days',
  journal: 'Lesson log',
  month: 'Month',
  allTeachers: 'All teachers',
  payouts: 'Teacher payouts',
  total: 'Total',
  extraLine: 'Extra line (Zoom, GoodNotes, one-off)',
  description: 'Description',
  review_draft: 'draft',
  review_checked: 'checked',
  review_paid: 'paid',
  markChecked: 'Checked',
  markPaid: 'Paid',
  team: 'Team',
  invite: 'Invite',
  inviteHint: 'They sign in with this email using the link we send. The profile is created on first sign-in.',
  ratesTemplate: 'Rates',
  tpl_400: '400 / 420 / 460 (B1+: 420 for 8 lessons, 460 for 12)',
  tpl_450: '450 / 520',
  tpl_550: '550 / 600',
  tpl_none: 'no rates, add later',
  pending: 'not signed in yet',
  rates: 'Rates',
  addRate: 'Add rate',
  anyLevel: 'any level',
  bandA: 'A0-A2',
  bandB: 'B1+',
  anyPackage: 'any package',
  packageOf: '{n}-lesson package',
  validFrom: 'Valid from',
  library: 'Library',
  upload: 'Upload PDF',
  title: 'Title',
  file: 'File',
  viewOnly: 'View only, no download',
  showMode: 'Show mode',
  exitShow: 'Exit show mode',
  page: 'page {n} of {total}',
  prev: 'Back',
  next: 'Next',
};

export type Key = keyof typeof uk;
const dictionaries: Record<Locale, typeof uk> = { uk, en };

export function translator(locale: Locale) {
  const dict = dictionaries[locale] ?? uk;
  return (key: Key, vars?: Record<string, string | number>) => {
    let s: string = dict[key] ?? uk[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
    return s;
  };
}

export type T = ReturnType<typeof translator>;

// Dates are shown in Kyiv time: the school and most students are there.
export const SCHOOL_TZ = 'Europe/Kyiv';

export function fmtDateTime(iso: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === 'uk' ? 'uk-UA' : 'en-GB', {
    timeZone: SCHOOL_TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso));
}

export function fmtDate(iso: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === 'uk' ? 'uk-UA' : 'en-GB', {
    timeZone: SCHOOL_TZ, day: 'numeric', month: 'short', year: 'numeric',
  }).format(new Date(iso));
}

export function fmtMonth(monthStart: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === 'uk' ? 'uk-UA' : 'en-GB', {
    timeZone: 'UTC', month: 'long', year: 'numeric',
  }).format(new Date(monthStart + 'T00:00:00Z'));
}

export function fmtMoney(n: number | string, currency = 'UAH') {
  const v = Number(n);
  const s = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(v);
  return currency === 'UAH' ? `${s} грн` : `${s} ${currency}`;
}

// "2026-11-03T16:00" typed in a form means Kyiv time; turn it into an instant.
export function kyivLocalToIso(local: string) {
  const asUtc = new Date(local + ':00Z');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SCHOOL_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).formatToParts(asUtc);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const kyivWallAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  const offset = kyivWallAsUtc - asUtc.getTime();
  return new Date(asUtc.getTime() - offset).toISOString();
}

export function currentMonthStart() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: SCHOOL_TZ, year: 'numeric', month: '2-digit' })
    .formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  return `${y}-${m}-01`;
}
