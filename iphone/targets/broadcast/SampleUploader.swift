import CoreImage
import Foundation
import ImageIO
import ReplayKit

// Turns each screen picture into a JPEG and writes it to the socket in the
// format react-native-webrtc's ScreenCapturer reads (HTTP-style headers with
// the size and rotation). Adapted from Jitsi Meet (Apache 2.0).
class SampleUploader {
  private static let imageContext = CIContext(options: nil)
  private static let chunkSize = 10240

  private var isReady = false
  private let lock = NSLock()
  private let connection: SocketConnection
  private var dataToSend: Data?
  private var byteIndex = 0
  private let serialQueue = DispatchQueue(label: "com.amethos.mytechkid.broadcast.uploader")

  init(connection: SocketConnection) {
    self.connection = connection
    connection.didOpen = { [weak self] in self?.setReady(true) }
    connection.streamHasSpaceAvailable = { [weak self] in
      self?.serialQueue.async {
        if let sent = self?.sendDataChunk() { self?.setReady(!sent) }
      }
    }
  }

  /// Sends one picture, or skips it if the last one is still on its way.
  @discardableResult
  func send(sample buffer: CMSampleBuffer) -> Bool {
    guard takeReady() else { return false }
    guard let data = prepare(sample: buffer) else {
      setReady(true)
      return false
    }
    serialQueue.async { [weak self] in
      self?.dataToSend = data
      self?.byteIndex = 0
      self?.sendDataChunk()
    }
    return true
  }

  private func setReady(_ value: Bool) {
    lock.lock(); isReady = value; lock.unlock()
  }

  private func takeReady() -> Bool {
    lock.lock(); defer { lock.unlock() }
    guard isReady else { return false }
    isReady = false
    return true
  }

  @discardableResult
  private func sendDataChunk() -> Bool {
    guard let data = dataToSend else { return false }
    var bytesLeft = data.count - byteIndex
    var length = min(bytesLeft, SampleUploader.chunkSize)
    length = data[byteIndex..<(byteIndex + length)].withUnsafeBytes { raw in
      guard let ptr = raw.bindMemory(to: UInt8.self).baseAddress else { return 0 }
      return connection.writeToStream(buffer: ptr, maxLength: length)
    }
    if length > 0 {
      byteIndex += length
      bytesLeft -= length
      if bytesLeft == 0 {
        dataToSend = nil
        byteIndex = 0
      }
    }
    return true
  }

  private func prepare(sample buffer: CMSampleBuffer) -> Data? {
    guard let imageBuffer = CMSampleBufferGetImageBuffer(buffer) else { return nil }
    CVPixelBufferLockBaseAddress(imageBuffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(imageBuffer, .readOnly) }

    // Half size, like Mom's Android app sends.
    let scale = 2
    let width = CVPixelBufferGetWidth(imageBuffer) / scale
    let height = CVPixelBufferGetHeight(imageBuffer) / scale
    let orientation = (CMGetAttachment(buffer, key: RPVideoSampleOrientationKey as CFString, attachmentModeOut: nil) as? NSNumber)?.uint32Value ?? 0
    let transform = CGAffineTransform(scaleX: 1 / CGFloat(scale), y: 1 / CGFloat(scale))
    guard let jpeg = jpegData(from: imageBuffer, transform: transform) else { return nil }

    let message = CFHTTPMessageCreateResponse(nil, 200, nil, kCFHTTPVersion1_1).takeRetainedValue()
    CFHTTPMessageSetHeaderFieldValue(message, "Content-Length" as CFString, String(jpeg.count) as CFString)
    CFHTTPMessageSetHeaderFieldValue(message, "Buffer-Width" as CFString, String(width) as CFString)
    CFHTTPMessageSetHeaderFieldValue(message, "Buffer-Height" as CFString, String(height) as CFString)
    CFHTTPMessageSetHeaderFieldValue(message, "Buffer-Orientation" as CFString, String(orientation) as CFString)
    CFHTTPMessageSetBody(message, jpeg as CFData)
    return CFHTTPMessageCopySerializedMessage(message)?.takeRetainedValue() as Data?
  }

  private func jpegData(from buffer: CVPixelBuffer, transform: CGAffineTransform) -> Data? {
    let image = CIImage(cvPixelBuffer: buffer).transformed(by: transform)
    guard let colorSpace = image.colorSpace ?? CGColorSpace(name: CGColorSpace.sRGB) else { return nil }
    let options: [CIImageRepresentationOption: Any] = [
      CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String): 0.8,
    ]
    return SampleUploader.imageContext.jpegRepresentation(of: image, colorSpace: colorSpace, options: options)
  }
}
