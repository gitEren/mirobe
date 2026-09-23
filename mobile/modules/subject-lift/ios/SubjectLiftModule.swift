import CoreImage
import ExpoModulesCore
import UniformTypeIdentifiers
import Vision

/// On-device "subject lifting" (the same Vision model behind iOS' long-press
/// copy-subject). Keeps the original pixels, so fabric, print and colour are
/// exactly what the camera captured — no generative re-drawing.
public class SubjectLiftModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SubjectLift")

    Constant("isSupported") {
      if #available(iOS 17.0, *) { return true }
      return false
    }

    AsyncFunction("liftSubject") { (uri: String) -> [String: Any]? in
      guard #available(iOS 17.0, *) else { return nil }
      guard let url = URL(string: uri) else { throw Exception(name: "InvalidUri", description: "Invalid uri \(uri)") }
      return try Self.lift(url: url)
    }
  }

  @available(iOS 17.0, *)
  private static func lift(url: URL) throws -> [String: Any]? {
    let handler = VNImageRequestHandler(url: url)
    let request = VNGenerateForegroundInstanceMaskRequest()
    try handler.perform([request])
    guard let observation = request.results?.first, !observation.allInstances.isEmpty else { return nil }

    // Keep every instance that is at least a quarter the size of the biggest one:
    // a pair of shoes stays together, a hand holding a hanger gets dropped.
    var areas: [(Int, Int)] = []
    for instance in observation.allInstances {
      let mask = try observation.generateScaledMaskForImage(forInstances: IndexSet(integer: instance), from: handler)
      areas.append((instance, maskArea(mask)))
    }
    let largest = areas.map(\.1).max() ?? 0
    let kept = IndexSet(areas.filter { Double($0.1) >= Double(largest) * 0.25 }.map(\.0))

    let fullMask = try observation.generateScaledMaskForImage(forInstances: kept, from: handler)
    let coverage = Double(maskArea(fullMask)) / Double(CVPixelBufferGetWidth(fullMask) * CVPixelBufferGetHeight(fullMask))

    let buffer = try observation.generateMaskedImage(ofInstances: kept, from: handler, croppedToInstancesExtent: true)
    let image = CIImage(cvPixelBuffer: buffer)
    let context = CIContext()
    guard let cgImage = context.createCGImage(image, from: image.extent) else { return nil }

    let output = FileManager.default.temporaryDirectory.appendingPathComponent("lift-\(UUID().uuidString).png")
    guard let destination = CGImageDestinationCreateWithURL(output as CFURL, UTType.png.identifier as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(destination, cgImage, nil)
    guard CGImageDestinationFinalize(destination) else { return nil }

    return [
      "uri": output.absoluteString,
      "width": cgImage.width,
      "height": cgImage.height,
      "coverage": coverage,
      "instances": kept.count,
    ]
  }

  /// Counts mask pixels above 0.5 (masks are single-channel Float32).
  private static func maskArea(_ mask: CVPixelBuffer) -> Int {
    CVPixelBufferLockBaseAddress(mask, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(mask, .readOnly) }
    guard let base = CVPixelBufferGetBaseAddress(mask) else { return 0 }
    let width = CVPixelBufferGetWidth(mask)
    let height = CVPixelBufferGetHeight(mask)
    let rowBytes = CVPixelBufferGetBytesPerRow(mask)
    var count = 0
    for y in stride(from: 0, to: height, by: 2) {
      let row = base.advanced(by: y * rowBytes).assumingMemoryBound(to: Float32.self)
      for x in stride(from: 0, to: width, by: 2) where row[x] > 0.5 {
        count += 4
      }
    }
    return count
  }
}
