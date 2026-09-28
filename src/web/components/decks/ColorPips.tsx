import { ManaText } from '../ManaText.tsx'

/** A deck's color identity as mana symbols; colorless shows {C}. */
export function ColorPips({ identity, className }: { identity: string; className?: string }) {
  const text = identity === '' ? '{C}' : [...identity].map((c) => `{${c}}`).join('')
  return <ManaText text={text} className={className} />
}
