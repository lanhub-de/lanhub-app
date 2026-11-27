import type { T } from '@/lib/i18n';

// The package part of a form: how many lessons, paid in full or in parts
// (then only what is paid now is entered; the rest is recorded when she pays),
// the sum. The part fields show only when "in parts" is chosen.
export default function PackageFields({
  t, canSell, optionalPackage = false, currency = 'UAH',
}: { t: T; canSell: boolean; optionalPackage?: boolean; currency?: string }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="pkg-fields">
      <fieldset className="seg-set">
        <legend>{t('lessonsTotal')}</legend>
        <div className="seg-pick">
          {optionalPackage && <label><input type="radio" name="lessons_total" value="" defaultChecked />{t('noPackageYet')}</label>}
          {[4, 8, 12].map((n) => (
            <label key={n}><input type="radio" name="lessons_total" value={n} defaultChecked={!optionalPackage && n === 8} />{n}</label>
          ))}
          <label><input type="radio" name="lessons_total" value="other" />{t('otherCount')}</label>
        </div>
        <label className="other-only">{t('lessonsTotal')}<input name="lessons_custom" type="number" min={1} max={200} /></label>
      </fieldset>
      <input type="hidden" name="validity_months" value="1" />
      {canSell && (
        <>
          <fieldset className="seg-set">
            <legend>{t('payMode')}</legend>
            <div className="seg-pick">
              <label><input type="radio" name="pay" value="full" defaultChecked />{t('payFull')}</label>
              <label><input type="radio" name="pay" value="parts" />{t('payParts')}</label>
            </div>
          </fieldset>
          <div className="pay-box">
            <strong className="pay-parts-only">{t('payNow')}</strong>
            <div className="two">
              <label className="pay-parts-only">{t('payForLessons')}<input name="paid_lessons" type="number" min={1} max={23} placeholder="4" /></label>
              <label>{t('payAmount')}<input name="amount" type="number" min={0} step="0.01" placeholder={t('optional')} /></label>
              <label>€ / ₴
                <select name="currency" defaultValue={currency}>
                  <option value="UAH">UAH</option><option value="EUR">EUR</option><option value="USD">USD</option>
                </select>
              </label>
              <label>{t('payDate')}<input name="paid_at" type="date" defaultValue={today} /></label>
              <label>{t('method')}<input name="method" placeholder="WayForPay, monobank…" /></label>
            </div>
            <p className="pay-parts-only pay-note">{t('payRestNote')}</p>
          </div>
        </>
      )}
      <label>{t('note')}<input name="note" placeholder={t('pkgNoteHint')} /></label>
    </div>
  );
}
