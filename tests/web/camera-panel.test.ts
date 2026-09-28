import { describe, expect, it } from 'vitest'
import { describeCameraError } from '../../src/web/components/scan/CameraPanel.tsx'

// Binder.app's window (Electron names itself in its user agent, after Binder) and two browsers.
const BINDER_APP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Binder/0.1.0 Chrome/152.0.7977.130 Electron/44.4.5 Safari/537.36'
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'

const refused = new DOMException('Permission denied', 'NotAllowedError')

describe('describeCameraError', () => {
  it('sends a refused camera to System Settings in Binder.app, which has no address bar', () => {
    expect(describeCameraError(refused, BINDER_APP)).toBe(
      "Binder isn't allowed to use the camera. Turn Binder on in System Settings → Privacy & Security → Camera, then quit and reopen Binder.",
    )
  })

  it('sends a refused camera to the address bar in a browser', () => {
    for (const userAgent of [CHROME, SAFARI]) {
      expect(describeCameraError(refused, userAgent)).toBe(
        "Binder isn't allowed to use the camera. Allow it from the camera icon in the address bar, then press Start it again.",
      )
    }
  })

  it('says the same about a missing or busy camera in both', () => {
    for (const userAgent of [BINDER_APP, SAFARI]) {
      expect(describeCameraError(new DOMException('', 'NotFoundError'), userAgent)).toBe('No camera found.')
      expect(describeCameraError(new DOMException('', 'NotReadableError'), userAgent)).toBe('The camera is in use by another app.')
    }
  })
})
