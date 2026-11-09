/** Shared two-column radio cards for multi-account providers and single-account methods. */
export interface ProviderCardChoice {
  id: string
  name: string
  label: string
  note?: string
  signedIn?: boolean
  mark?: string
}
export function ProviderCards({ choices, chosen, label, onChoose }: {
  choices: ProviderCardChoice[]
  chosen?: string
  label: string
  onChoose: (id: string) => void
}) {
  return (
    <div className="cwn-accounts-providers" role="radiogroup" aria-label={label}>
      {choices.map((choice, index) => (
        <button key={choice.id} type="button" role="radio" aria-checked={chosen === choice.id}
          aria-label={choice.label} title={choice.name}
          tabIndex={chosen === choice.id || (!choices.some(item => item.id === chosen) && index === 0) ? 0 : -1}
          className="cwn-accounts-provider" data-selected={chosen === choice.id || undefined}
          onClick={() => onChoose(choice.id)}
          onKeyDown={event => {
            const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
              : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
            if (!delta && event.key !== 'Home' && event.key !== 'End') return
            event.preventDefault()
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
              : (index + delta + choices.length) % choices.length
            onChoose(choices[next]!.id)
            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
          }}>
          <span className="cwn-accounts-mark" aria-hidden="true">{choice.mark ?? choice.name.trim().charAt(0).toUpperCase()}</span>
          <span className="cwn-accounts-provider-text">
            <strong>{choice.name}</strong>
            {choice.note && <span data-signed-in={choice.signedIn || undefined}>{choice.note}</span>}
          </span>
        </button>
      ))}
    </div>
  )
}
