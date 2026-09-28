import { CameraPanel } from '../components/scan/CameraPanel.tsx'
import { ScanQueue } from '../components/scan/ScanQueue.tsx'
import { ScanTargetBar } from '../components/scan/ScanTarget.tsx'
import { useAnnounceAutoAdded, useCapture, useScanTarget } from '../lib/scan.ts'

/**
 * Scan cards into the collection, and into a deck as well (spec §5.1): where they go at the top, the camera on the
 * left, and the queue on the right.
 */
export function ScanPage() {
  const capture = useCapture()
  const { target, setTarget } = useScanTarget()
  useAnnounceAutoAdded()
  return (
    <div className="space-y-6">
      <h1 className="font-serif text-3xl font-semibold text-stone-50">Scan</h1>
      <ScanTargetBar target={target} onChange={setTarget} />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <CameraPanel onCapture={(jpeg, auto, lifted) => capture.mutate({ jpeg, auto, lifted, target })} />
        <ScanQueue target={target} onTarget={setTarget} />
      </div>
    </div>
  )
}
