'use client';
import { useFormStatus } from 'react-dom';

// A submit button that shows at once that the tap was taken, while the
// change is saved and the page refreshes in place.
export default function Submit({
  children, className = '', title, ariaLabel, ariaPressed, formAction,
}: {
  children: React.ReactNode; className?: string; title?: string; ariaLabel?: string; ariaPressed?: boolean;
  formAction?: (formData: FormData) => void | Promise<void>;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" formAction={formAction} className={`${className} ${pending ? 'is-pending' : ''}`} disabled={pending}
      title={title} aria-label={ariaLabel} aria-pressed={ariaPressed} aria-busy={pending}>
      {children}
    </button>
  );
}
