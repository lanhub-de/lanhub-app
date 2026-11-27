import type { T } from '@/lib/i18n';
import { setStudentStatus } from '@/app/school/actions';
import { WHY_DIAGNOSTIC, WHY_RENEWAL } from '@/lib/manager';
import Submit from '@/components/Submit';

// "Not continuing" / "did not buy": the student leaves the lists, and the
// school keeps why. The reason is required.
export default function WhyForm({
  t, studentId, returnTo, after = 'renewal', label,
}: { t: T; studentId: string; returnTo: string; after?: 'renewal' | 'diagnostic'; label?: string }) {
  const reasons = after === 'diagnostic' ? WHY_DIAGNOSTIC : WHY_RENEWAL;
  return (
    <details className="why">
      <summary className="link-btn quiet">{label ?? t(after === 'diagnostic' ? 'whyNotBought' : 'markLeft')}</summary>
      <form action={setStudentStatus} className="why-form">
        <input type="hidden" name="id" value={studentId} />
        <input type="hidden" name="status" value="left" />
        <input type="hidden" name="return_to" value={returnTo} />
        <label>{t(after === 'diagnostic' ? 'whyLabelDiag' : 'whyLabel')}
          <select name="left_reason" required defaultValue="">
            <option value="" disabled>{t('whyPick')}</option>
            {reasons.map((r) => <option key={r} value={r}>{t(`why_${r}` as never)}</option>)}
          </select>
        </label>
        <label className="why-note">{t('whyNote')}<input name="left_note" maxLength={300} placeholder={t('whyNoteHint')} /></label>
        <Submit className="small dark">{t('save')}</Submit>
      </form>
    </details>
  );
}
