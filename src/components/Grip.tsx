/** Ícone da alça de arrastar (seis pontos). */
export default function Grip() {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 20" className="h-4 w-3" fill="currentColor">
      <circle cx="3" cy="4" r="1.5" />
      <circle cx="9" cy="4" r="1.5" />
      <circle cx="3" cy="10" r="1.5" />
      <circle cx="9" cy="10" r="1.5" />
      <circle cx="3" cy="16" r="1.5" />
      <circle cx="9" cy="16" r="1.5" />
    </svg>
  );
}

export const gripButtonClass =
  "focus-ring grid h-8 w-5 shrink-0 touch-none place-items-center rounded text-faint hover:text-ink";
