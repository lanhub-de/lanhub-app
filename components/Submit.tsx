'use client';
import { useFormStatus } from 'react-dom';

type Props = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'formAction'> & {
  ariaLabel?: string; ariaPressed?: boolean;
  formAction?: (formData: FormData) => void | Promise<void>;
};

// A submit button that shows at once that the tap was taken, while the
// change is saved and the page refreshes in place.
export default function Submit({ children, className = '', ariaLabel, ariaPressed, formAction, disabled, ...rest }: Props) {
  const { pending } = useFormStatus();
  return (
    <button {...rest} type="submit" formAction={formAction} className={`${className} ${pending ? 'is-pending' : ''}`.trim()}
      disabled={pending || disabled} aria-label={ariaLabel ?? rest['aria-label']} aria-pressed={ariaPressed ?? rest['aria-pressed']}
      aria-busy={pending}>
      {children}
    </button>
  );
}
