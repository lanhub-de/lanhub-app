'use client';
import { useEffect } from 'react';

// Tells the page (and the update bar) which language this person uses.
export default function LocaleMark({ locale }: { locale: string }) {
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
  }, [locale]);
  return null;
}
