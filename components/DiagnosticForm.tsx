import type { T } from '@/lib/i18n';
import { addDiagnostic } from '@/app/school/actions';
import Submit from '@/components/Submit';

// "Book a diagnostic": the school (owner, head teacher, managers) books a
// diagnostic lesson for a teacher. The person is usually new, so her card is
// made right here from a name and a contact. Teachers do not book these
// themselves; the teacher is paid the school's flat amount once it is held.
export default function DiagnosticForm({
  t, teachers, students, teacherId, returnTo, align = 'right', instagram = false,
}: {
  t: T; teachers: { id: string; full_name: string }[]; students: { id: string; full_name: string; level?: string | null }[];
  teacherId?: string; returnTo?: string; align?: 'left' | 'right'; instagram?: boolean;
}) {
  if (!teachers.length) return null;
  return (
    <details className="move schedule">
      <summary className="btn">+ {t('diagAdd')}</summary>
      <form action={addDiagnostic} className={`move-form schedule-form ${align === 'left' ? 'left' : ''}`}>
        <strong style={{ fontSize: 16 }}>{t('diagTitle')}</strong>
        {returnTo && <input type="hidden" name="return_to" value={returnTo} />}
        <label>
          {t('teacher')}
          <select name="teacher_id" required defaultValue={teacherId ?? ''}>
            <option value="" disabled>…</option>
            {teachers.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </label>
        <div className="schedule-two">
          <label>{t('whenKyiv')}<input type="datetime-local" name="starts_at" required /></label>
          <label>
            {t('duration')}
            <select name="duration_min" defaultValue="60">
              {[30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} {t('minShort')}</option>)}
            </select>
          </label>
        </div>
        <label>
          {t('student')}
          <select name="student_id" defaultValue="">
            <option value="">{t('diagNewStudent')}</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.full_name}{s.level ? ` · ${s.level}` : ''}</option>)}
          </select>
        </label>
        <label>{t('diagName')}<input name="full_name" maxLength={120} /></label>
        <div className="schedule-two" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
          <label>{t('level')}<input name="level" placeholder="A2, B1…" maxLength={20} style={{ minWidth: 0, width: '100%' }} /></label>
          <label>
            {t('market')}
            <select name="market" defaultValue="ua" style={{ minWidth: 0, width: '100%' }}>
              <option value="ua">{t('market_ua')}</option>
              <option value="intl">{t('market_intl')}</option>
            </select>
          </label>
        </div>
        {instagram && <label>Instagram<input name="instagram" placeholder="@nick" maxLength={100} /></label>}
        <label>{t('contact')}<input name="contact" placeholder="Telegram, +380…" maxLength={200} /></label>
        <label>{t('diagNote')}<textarea name="note" rows={2} maxLength={300} /></label>
        <label>{t('zoomLink')}<input type="url" name="zoom_url" placeholder={t('zoomOptional')} /></label>
        <Submit className="primary">{t('diagSave')}</Submit>
        <small className="muted">{t('diagHint')}</small>
      </form>
    </details>
  );
}
