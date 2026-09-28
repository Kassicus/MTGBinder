import { useEffect, useRef, useState } from 'react'
import {
  type AutoStatus,
  boxAverage,
  cameraRank,
  cameraToUse,
  captureRect,
  createAutoCapture,
  guideRect,
  MAC_CAMERA_RANK,
  SAMPLE_MS,
  SAMPLE_SCALE,
  SAMPLE_SIZE,
  spaceCaptures,
} from '../../lib/capture.ts'
import { shortcutAllowed } from '../../lib/shortcuts.ts'

const CAMERA_KEY = 'binder.scan.camera'
const MODE_KEY = 'binder.scan.mode'

/** What auto mode says it's doing, under the camera (spec §5.1.1). */
const AUTO_STATUS: Record<AutoStatus, string> = {
  learning: 'Auto: clear the guide to start, so it can see the empty mat.',
  ready: 'Auto: ready. Place a card in the guide.',
  settling: 'Auto: hold still…',
  captured: 'Auto: captured. Lift the card for the next one.',
}

type Mode = 'manual' | 'auto'

const stored = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private windows can refuse storage; the choice just isn't remembered.
  }
}

function describeCameraError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError') return "Binder isn't allowed to use the camera. Allow it from the camera icon in the address bar, then press Start it again."
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera found.'
  if (name === 'NotReadableError') return 'The camera is in use by another app.'
  return `Couldn't start the camera: ${err instanceof Error ? err.message : String(err)}`
}

/** How late a beep may still play: a capture's beep held back longer (see beep) is left out. */
const BEEP_LATE_MS = 250

/** Plays one short tone now. */
function tone(ctx: AudioContext) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.frequency.value = 880
  gain.gain.setValueAtTime(0.15, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12)
  osc.connect(gain).connect(ctx.destination)
  osc.start()
  osc.stop(ctx.currentTime + 0.12)
}

/**
 * A short beep through Web Audio, for capture feedback. A context that isn't running yet (a new one, or one started
 * before the page was clicked, which autoplay rules keep suspended) beeps once it resumes, unless that takes longer
 * than BEEP_LATE_MS: captures taken meanwhile don't all beep at once on the first click.
 */
function beep(audio: { ctx: AudioContext | null }) {
  try {
    audio.ctx ??= new AudioContext()
    const ctx = audio.ctx
    if (ctx.state === 'running') return tone(ctx)
    const asked = performance.now()
    void ctx
      .resume()
      .then(() => {
        if (performance.now() - asked < BEEP_LATE_MS) tone(ctx)
      })
      .catch(() => {})
  } catch {
    // No audio device; the flash still shows.
  }
}

/**
 * The camera side of the Scan page (spec §5.1.1): camera picker (remembered), live preview with a card-shaped guide,
 * and capture by button, Space, or auto mode. Each capture is the guide region (plus a margin) as JPEG.
 */
export function CameraPanel({ onCapture }: { onCapture: (jpeg: Blob, auto: boolean, lifted: boolean) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const audio = useRef<{ ctx: AudioContext | null }>({ ctx: null })
  const [devices, setDevices] = useState<MediaDeviceInfo[] | null>(null)
  const [deviceId, setDeviceId] = useState(() => stored(CAMERA_KEY))
  /**
   * The camera that stopped (see `stopped`): it stays the one in use, none while it isn't listed, and it starts again
   * once it's back, until a stream runs or the owner picks a camera.
   */
  const [lost, setLost] = useState<string | null>(null)
  /** The camera whose stream is running, if any. */
  const running = useRef<string | null>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** The camera stopped sending pictures: `ended` for good (unplugged, or the iPhone moved away), or `paused` for now. */
  const [stopped, setStopped] = useState<'ended' | 'paused' | null>(null)
  /** Bumped by Start it again, to look for cameras and start the camera again after it ended or failed to start. */
  const [restarts, setRestarts] = useState(0)
  const [mode, setMode] = useState<Mode>(() => (stored(MODE_KEY) === 'auto' ? 'auto' : 'manual'))
  const modeRef = useRef(mode)
  modeRef.current = mode
  const chooseMode = (m: Mode) => {
    setMode(m)
    store(MODE_KEY, m)
  }
  const chooseModeRef = useRef(chooseMode)
  chooseModeRef.current = chooseMode
  const [flashes, setFlashes] = useState(0)
  /** Auto mode's state machine while it runs, and what it's doing. */
  const autoRef = useRef<ReturnType<typeof createAutoCapture> | null>(null)
  const [autoStatus, setAutoStatus] = useState<AutoStatus>('learning')

  const chosen = devices ? cameraToUse(devices, deviceId, lost) : null
  /** The camera that stopped isn't listed: the page waits for it (or for the owner to pick another). */
  const waiting = lost !== null && chosen === null
  const restart = () => setRestarts((n) => n + 1)

  // Device labels are only visible once the camera is allowed, so a look that finds cameras without labels asks for
  // any camera first. A camera plugged in or out is listed again without opening one, and no camera at all is listed
  // as none. Start it again looks again too (after the camera wasn't allowed, say).
  useEffect(() => {
    let cancelled = false
    const cameras = async () => (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput')
    async function list() {
      try {
        let all = await cameras()
        if (all.length > 0 && !all.some((d) => d.label)) {
          const probe = await navigator.mediaDevices.getUserMedia({ video: true })
          for (const track of probe.getTracks()) track.stop()
          all = await cameras()
        }
        if (cancelled) return
        // The running camera gone from the list has stopped, even before its track says so (the two can come in
        // either order): waiting for it, in the same render as the new list, rather than switching to another.
        const gone = running.current
        if (gone !== null && !all.some((d) => d.deviceId === gone)) {
          setStopped('ended')
          setLost(gone)
        }
        setDevices(all)
      } catch (err) {
        if (!cancelled) setError(describeCameraError(err))
      }
    }
    void list()
    navigator.mediaDevices.addEventListener('devicechange', list)
    return () => {
      cancelled = true
      navigator.mediaDevices.removeEventListener('devicechange', list)
    }
  }, [restarts])

  // Runs the chosen camera. A camera that stopped and is listed again becomes the chosen one, which starts it here.
  useEffect(() => {
    if (!chosen) return
    const id = chosen.deviceId
    let stream: MediaStream | null = null
    let cancelled = false
    setSize(null)
    navigator.mediaDevices
      .getUserMedia({ video: { deviceId: { exact: id }, width: { ideal: 1920 }, height: { ideal: 1440 } } })
      .then((s) => {
        if (cancelled) {
          for (const track of s.getTracks()) track.stop()
          return
        }
        stream = s
        for (const track of s.getVideoTracks()) {
          track.addEventListener('ended', () => {
            if (cancelled) return
            setStopped('ended')
            setLost(id)
          })
          track.addEventListener('mute', () => !cancelled && setStopped((now) => now ?? 'paused'))
          track.addEventListener('unmute', () => !cancelled && setStopped((now) => (now === 'paused' ? null : now)))
        }
        if (videoRef.current) videoRef.current.srcObject = s
        running.current = id
        // Running: what stopped or failed before is over. Only now, so a failed Start it again still offers another.
        setStopped(null)
        setLost(null)
        setError(null)
      })
      .catch((err: unknown) => {
        // A camera switched away from while it was starting isn't this one's problem.
        if (!cancelled) setError(describeCameraError(err))
      })
    return () => {
      cancelled = true
      if (running.current === id) running.current = null
      for (const track of stream?.getTracks() ?? []) track.stop()
    }
  }, [chosen?.deviceId, restarts])

  // The audio device is let go of when the page closes.
  useEffect(() => {
    const current = audio.current
    return () => {
      void current.ctx?.close().catch(() => {})
      current.ctx = null
    }
  }, [])

  /** `lifted`: auto mode saw the empty mat since its last capture. */
  const capture = (auto: boolean, lifted = false) => {
    const video = videoRef.current
    // A camera that stopped sending pictures leaves its last one on screen: that isn't captured again.
    if (!video || video.videoWidth === 0 || stopped !== null) return
    // A capture by hand in auto mode: auto mode doesn't capture the same card again.
    if (!auto) autoRef.current?.captured()
    const { videoWidth: w, videoHeight: h } = video
    const r = captureRect(guideRect(w, h), w, h)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(r.width)
    canvas.height = Math.round(r.height)
    canvas.getContext('2d')?.drawImage(video, r.x, r.y, r.width, r.height, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(
      (jpeg) => {
        if (!jpeg) return
        onCapture(jpeg, auto, lifted)
        beep(audio.current)
        setFlashes((n) => n + 1)
      },
      'image/jpeg',
      0.92,
    )
  }
  const captureRef = useRef(capture)
  captureRef.current = capture

  // Manual capture: Space, unless typing in a text field or while a modal dialog (the card drawer) is open, which keep
  // their own Space, even when focus has fallen back to the page behind the drawer. On a focused button or select
  // (Chrome keeps focus on a clicked button), Space captures instead of pressing it: keydown and keyup both lose their
  // default action. `a` switches between Auto and Manual, as the page's other shortcuts do (not while typing).
  useEffect(() => {
    const modalOpen = () => document.querySelector('[aria-modal="true"]') !== null
    const spaceHere = (e: KeyboardEvent) => e.key === ' ' && spaceCaptures(e.target instanceof HTMLElement ? e.target : null, modalOpen())
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'a' && !e.repeat && shortcutAllowed(e, modalOpen())) {
        e.preventDefault()
        chooseModeRef.current(modeRef.current === 'auto' ? 'manual' : 'auto')
        return
      }
      if (!spaceHere(e)) return
      e.preventDefault()
      if (!e.repeat) captureRef.current(false)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (spaceHere(e)) e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  // Auto mode (spec §5.1.1): sample the guide region, averaged into small blocks, and capture a card once it holds
  // still. Starting (the mode chosen, or the camera started) learns the empty mat again.
  useEffect(() => {
    if (mode !== 'auto' || !size) return
    const auto = createAutoCapture()
    autoRef.current = auto
    setAutoStatus('learning')
    const canvas = document.createElement('canvas')
    canvas.width = SAMPLE_SIZE.width * SAMPLE_SCALE
    canvas.height = SAMPLE_SIZE.height * SAMPLE_SCALE
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (ctx) ctx.imageSmoothingQuality = 'high'
    const timer = setInterval(() => {
      const video = videoRef.current
      if (!ctx || !video || video.readyState < 2) return
      const g = guideRect(video.videoWidth, video.videoHeight)
      ctx.drawImage(video, g.x, g.y, g.width, g.height, 0, 0, canvas.width, canvas.height)
      const big = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      const step = auto.sample(boxAverage(big, SAMPLE_SIZE.width, SAMPLE_SIZE.height, SAMPLE_SCALE), performance.now())
      setAutoStatus(step.status)
      if (step.capture) captureRef.current(true, step.lifted)
    }, SAMPLE_MS)
    return () => {
      clearInterval(timer)
      if (autoRef.current === auto) autoRef.current = null
    }
  }, [mode, size])

  /** Takes the picture's size, keeping the same object when it hasn't changed, so auto mode doesn't start over. */
  const fit = (video: HTMLVideoElement) => {
    const { videoWidth: width, videoHeight: height } = video
    setSize((now) => (now?.width === width && now.height === height ? now : { width, height }))
  }
  const guide = size ? guideRect(size.width, size.height) : null
  // Only the Mac's own cameras (or none): explain how to use the iPhone.
  const noPhone = devices !== null && devices.every((d) => cameraRank(d.label) >= MAC_CAMERA_RANK)
  const button = (active: boolean) =>
    `rounded-md px-3 py-1 text-sm ${active ? 'bg-stone-700 text-stone-50' : 'text-stone-400 hover:text-stone-100'}`

  return (
    <section aria-label="Camera" className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label="Camera"
          value={chosen?.deviceId ?? ''}
          onChange={(e) => {
            // The owner's pick replaces the camera that stopped, and what was said about it.
            setDeviceId(e.target.value)
            setLost(null)
            setStopped(null)
            store(CAMERA_KEY, e.target.value)
          }}
          disabled={!devices || devices.length === 0}
          className="min-w-0 flex-1 rounded-md border border-stone-700 bg-stone-900 px-2 py-1.5 text-sm text-stone-100"
        >
          {devices?.length === 0 && <option value="">No camera found</option>}
          {/* Selected while waiting, so picking any listed camera, the first one too, is a change. */}
          {waiting && devices?.length !== 0 && <option value="">Waiting for the camera that stopped</option>}
          {devices?.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Camera ${i + 1}`}
            </option>
          ))}
        </select>
        <div role="radiogroup" aria-label="Capture mode" className="flex rounded-lg border border-stone-800 p-0.5">
          {(['manual', 'auto'] as const).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={mode === m}
              onClick={() => chooseMode(m)}
              className={button(mode === m)}
            >
              {m === 'manual' ? 'Manual' : 'Auto'}
            </button>
          ))}
        </div>
      </div>

      <div
        className="relative overflow-hidden rounded-xl border border-stone-800 bg-black"
        style={{ aspectRatio: size ? `${size.width} / ${size.height}` : '4 / 3' }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onLoadedMetadata={(e) => fit(e.currentTarget)}
          // The picture's size changes when an iPhone is turned, for example.
          onResize={(e) => fit(e.currentTarget)}
          className="absolute inset-0 h-full w-full"
        />
        {guide && size && (
          <div
            aria-hidden
            className="pointer-events-none absolute rounded-[5%] border-2 border-amber-400/80 shadow-[0_0_0_9999px_rgba(12,10,9,0.5)]"
            style={{
              left: `${(guide.x / size.width) * 100}%`,
              top: `${(guide.y / size.height) * 100}%`,
              width: `${(guide.width / size.width) * 100}%`,
              height: `${(guide.height / size.height) * 100}%`,
            }}
          />
        )}
        {flashes > 0 && <div key={flashes} aria-hidden className="pointer-events-none absolute inset-0 animate-flash bg-white" />}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => capture(false)}
          disabled={!size || stopped !== null}
          className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-stone-950 hover:bg-amber-400 disabled:opacity-50"
        >
          Capture
        </button>
        <p className="text-sm text-stone-400">
          {mode === 'auto' ? AUTO_STATUS[autoStatus] : 'Place a card in the guide, then press Capture or Space.'}
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-200">
          {error}
          {/* The camera-stopped alert below has its own. */}
          {stopped !== 'ended' && (
            <>
              {' '}
              <button onClick={restart} className="font-medium text-rose-100 underline">
                Start it again
              </button>
            </>
          )}
        </p>
      )}
      {stopped === 'ended' && (
        <p role="alert" className="rounded-lg border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-200">
          The camera stopped: it may have been unplugged, or the iPhone moved away.{' '}
          {waiting ? (
            `It starts again by itself once it's back${devices?.length ? ', or choose another camera above' : ''}.`
          ) : (
            <button onClick={restart} className="font-medium text-amber-300 underline">
              Start it again
            </button>
          )}
        </p>
      )}
      {stopped === 'paused' && (
        <p role="status" className="rounded-lg border border-stone-800 bg-stone-900/60 p-3 text-sm text-stone-300">
          The camera isn't sending pictures right now. It picks up again by itself.
        </p>
      )}
      {noPhone && (
        <div className="rounded-lg border border-stone-800 bg-stone-900/60 p-3 text-sm text-stone-400">
          <p className="font-medium text-stone-300">Using your iPhone as the camera (Continuity Camera)</p>
          <p className="mt-1">
            Sign both devices into the same Apple ID with Wi-Fi and Bluetooth on. For USB, plug the iPhone in and trust
            this Mac. Lock the iPhone, keep it still in landscape, and mount it over the scanning area; it then appears
            in the camera list under your iPhone's name, like "My iPhone Camera".
          </p>
        </div>
      )}
    </section>
  )
}
