import { useState } from 'react'
import type { CardData, CardState, PlayFace } from '../../../shared/playtest/types.ts'
import { CARD_RATIO, counterTag, SMALL_IMAGE_HEIGHT } from '../../lib/playtest-board.ts'

/** Colors of a text frame, by a card's colors (a token from the form, or a card whose image didn't load). */
const FRAME: Record<string, string> = {
  W: 'bg-amber-50 text-stone-900',
  U: 'bg-sky-200 text-stone-900',
  B: 'bg-stone-400 text-stone-950',
  R: 'bg-red-200 text-stone-900',
  G: 'bg-emerald-200 text-stone-900',
}
const frameColor = (colors: string) =>
  colors.length === 1 ? FRAME[colors]! : colors.length > 1 ? 'bg-amber-200 text-stone-900' : 'bg-stone-300 text-stone-900'

/** A card's back: what the other seat sees of a hand, a library, or a face-down card. */
export function CardBack({ height, className = '' }: { height: number; className?: string }) {
  return (
    <div
      style={{ height, width: height / CARD_RATIO }}
      className={`shrink-0 rounded-[6%] border border-black/60 bg-[repeating-linear-gradient(45deg,#5b3a22_0_4px,#6f4a2c_4px_8px)] shadow ${className}`}
    />
  )
}

/** A card with no image: its name, cost, type line, and power/toughness, colored by its colors. */
export function TextFrame({ face, colors, token, height }: { face: PlayFace; colors: string; token: boolean; height: number }) {
  // The words grow with the card, so the large preview reads as well as the board's small card.
  const fontSize = Math.max(9, Math.round(height * 0.06))
  return (
    <div
      style={{ height, width: height / CARD_RATIO, fontSize, padding: fontSize / 2 }}
      className={`flex shrink-0 flex-col justify-between overflow-hidden rounded-[6%] border leading-tight ${frameColor(colors)} ${token ? 'border-dashed border-amber-600' : 'border-black/60'}`}
    >
      <div>
        <div className="font-semibold">{face.name}</div>
        {face.manaCost && <div className="opacity-70">{face.manaCost}</div>}
      </div>
      <div>
        <div className="opacity-80">{token && !/\btoken\b/i.test(face.typeLine) ? `Token ${face.typeLine}` : face.typeLine}</div>
        {face.power !== null && face.toughness !== null && (
          <div className="text-right font-semibold">
            {face.power}/{face.toughness}
          </div>
        )}
      </div>
    </div>
  )
}

/** The face showing, and the image to draw it with: the small image for a card's front drawn small. */
function faceImage(data: CardData, face: number, large: boolean): { face: PlayFace; image: string | null } {
  const shown = data.faces[face] ?? data.faces[0]!
  if (face === 0 && !large && data.imageSmall) return { face: shown, image: data.imageSmall }
  return { face: shown, image: shown.image }
}

/**
 * A card's face: its image (or a text frame when it has none, or it doesn't load), turned sideways when tapped, with
 * its counters as tags. `hidden` draws its back; `faceDown` (seen by its controller) draws its face dimmed.
 */
export function CardView({
  data,
  card,
  height,
  hidden = false,
  large = false,
  selected = false,
}: {
  data: CardData
  card?: CardState
  height: number
  hidden?: boolean
  large?: boolean
  selected?: boolean
}) {
  const [broken, setBroken] = useState<string | null>(null)
  if (hidden) return <CardBack height={height} />
  const { face, image } = faceImage(data, card?.face ?? 0, large || height > SMALL_IMAGE_HEIGHT)
  const counters = Object.entries(card?.counters ?? {})
  const token = card?.token ?? false
  return (
    <div
      style={{ height, width: height / CARD_RATIO }}
      className={`relative shrink-0 rounded-[6%] ${selected ? 'ring-2 ring-amber-400 ring-offset-1 ring-offset-stone-950' : ''}`}
    >
      {image && broken !== image ? (
        <img
          src={image}
          alt={face.name}
          draggable={false}
          onError={() => setBroken(image)}
          className={`h-full w-full rounded-[6%] object-cover shadow-md shadow-black/50 ${token ? 'outline-2 outline-offset-[-2px] outline-amber-500/80 outline-dashed' : ''}`}
        />
      ) : (
        <TextFrame face={face} colors={data.colors} token={token} height={height} />
      )}
      {card?.faceDown && (
        <div className="absolute inset-0 flex items-center justify-center rounded-[6%] bg-stone-950/60 text-[10px] font-semibold tracking-wide text-stone-200 uppercase">
          Face down
        </div>
      )}
      {counters.length > 0 && (
        <div className="absolute inset-x-0 bottom-1 flex flex-wrap justify-center gap-0.5 px-0.5">
          {counters.map(([name, value]) => (
            <span key={name} className="rounded bg-amber-500 px-1 text-[10px] leading-4 font-bold text-stone-950 shadow">
              {counterTag(name, value)}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
