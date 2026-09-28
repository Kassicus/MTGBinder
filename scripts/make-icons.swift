// Draws Binder.app's icons into a folder: the app icon (a 9-pocket binder page in Binder's stone and amber) as
// Binder.icns and icon.png, and the menu-bar icon (the same page, as a template macOS tints) at 1x and 2x.
// usage: swift scripts/make-icons.swift <out-dir>
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let out = URL(fileURLWithPath: CommandLine.arguments[1])
try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
let space = CGColorSpace(name: CGColorSpace.sRGB)!

func color(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
  CGColor(srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255,
          blue: CGFloat(hex & 0xff) / 255, alpha: alpha)
}

func image(_ size: Int, _ draw: (CGContext, CGFloat) -> Void) -> CGImage {
  let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  draw(ctx, CGFloat(size))
  return ctx.makeImage()!
}

func save(_ picture: CGImage, _ name: String) {
  let dest = CGImageDestinationCreateWithURL(out.appendingPathComponent(name) as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, picture, nil)
  CGImageDestinationFinalize(dest)
}

func rounded(_ ctx: CGContext, _ rect: CGRect, _ radius: CGFloat) {
  ctx.addPath(CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil))
}

/** The 3 × 3 pockets of a binder page inside `page`, each card-shaped (63:88). */
func pockets(_ page: CGRect, gap: CGFloat) -> [CGRect] {
  let w = (page.width - gap * 4) / 3
  let h = (page.height - gap * 4) / 3
  return (0..<9).map { i in
    CGRect(x: page.minX + gap + CGFloat(i % 3) * (w + gap), y: page.minY + gap + CGFloat(i / 3) * (h + gap), width: w, height: h)
  }
}

// The app icon, on macOS's icon grid: an 824-point rounded square in a 1024 canvas.
let appIcon = image(1024) { ctx, s in
  let tile = CGRect(x: 100, y: 100, width: 824, height: 824)
  ctx.saveGState()
  ctx.setShadow(offset: CGSize(width: 0, height: -12), blur: 28, color: color(0x000000, 0.45))
  rounded(ctx, tile, 185)
  ctx.setFillColor(color(0x1c1917))
  ctx.fillPath()
  ctx.restoreGState()
  ctx.saveGState()
  rounded(ctx, tile, 185)
  ctx.clip()
  let gradient = CGGradient(colorsSpace: space, colors: [color(0x292524), color(0x0c0a09)] as CFArray, locations: [0, 1])!
  ctx.drawLinearGradient(gradient, start: CGPoint(x: 0, y: tile.maxY), end: CGPoint(x: 0, y: tile.minY), options: [])
  ctx.restoreGState()
  // The page, card-shaped itself, with its pockets.
  let page = CGRect(x: s / 2 - 240, y: s / 2 - 320, width: 480, height: 640)
  rounded(ctx, page, 36)
  ctx.setFillColor(color(0x44403c))
  ctx.fillPath()
  for (i, pocket) in pockets(page, gap: 22).enumerated() {
    rounded(ctx, pocket, 14)
    // One card lit amber (the middle); the rest in deep amber, like a sleeved collection.
    ctx.setFillColor(i == 4 ? color(0xfbbf24) : color(0xb45309, i % 2 == 0 ? 0.95 : 0.75))
    ctx.fillPath()
  }
}
save(appIcon, "icon.png")

// The menu-bar icon: black pockets on clear, which macOS tints for the menu bar (a "Template" image).
for (scale, name) in [(1, "trayTemplate.png"), (2, "trayTemplate@2x.png")] {
  let icon = image(16 * scale) { ctx, s in
    let unit = s / 16
    let page = CGRect(x: 2.5 * unit, y: 0.5 * unit, width: 11 * unit, height: 15 * unit)
    ctx.setFillColor(color(0x000000))
    for pocket in pockets(page, gap: 1 * unit) {
      rounded(ctx, pocket, 0.8 * unit)
      ctx.fillPath()
    }
  }
  save(icon, name)
}

// Binder.icns, from an iconset of every size macOS asks for.
let iconset = out.appendingPathComponent("Binder.iconset")
try? FileManager.default.removeItem(at: iconset)
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
for base in [16, 32, 128, 256, 512] {
  for scale in [1, 2] {
    let px = base * scale
    let scaled = image(px) { ctx, s in
      ctx.interpolationQuality = .high
      ctx.draw(appIcon, in: CGRect(x: 0, y: 0, width: s, height: s))
    }
    let dest = CGImageDestinationCreateWithURL(
      iconset.appendingPathComponent(scale == 1 ? "icon_\(base)x\(base).png" : "icon_\(base)x\(base)@2x.png") as CFURL,
      UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, scaled, nil)
    CGImageDestinationFinalize(dest)
  }
}
let iconutil = Process()
iconutil.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
iconutil.arguments = ["-c", "icns", iconset.path, "-o", out.appendingPathComponent("Binder.icns").path]
try iconutil.run()
iconutil.waitUntilExit()
try? FileManager.default.removeItem(at: iconset)
guard iconutil.terminationStatus == 0 else { fatalError("iconutil failed") }
