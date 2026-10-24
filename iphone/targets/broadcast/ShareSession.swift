import CoreMedia
import Foundation
import ImageIO
import ReplayKit
import WebRTC

// Sends Mom's screen to her helper's watch page (web/src/watch.js) for as
// long as Apple's red bar shows, even while she uses other apps. It speaks
// the same language as her Android app (ScreenShareService.kt): the picture
// goes phone to phone over WebRTC (end-to-end encrypted), and Firestore only
// carries the setup messages. iPhone can't be tapped for, so the "control"
// channel only answers pings.

/// What the app hands over when Mom taps Share my screen (src/lib/share.ts).
struct ShareRequest: Decodable {
  struct IceServer: Decodable {
    let urls: [String]
    let username: String?
    let credential: String?

    enum CodingKeys: String, CodingKey { case urls, username, credential }

    init(from decoder: Decoder) throws {
      let c = try decoder.container(keyedBy: CodingKeys.self)
      if let list = try? c.decode([String].self, forKey: .urls) {
        urls = list
      } else {
        urls = [try c.decode(String.self, forKey: .urls)]
      }
      username = try c.decodeIfPresent(String.self, forKey: .username)
      credential = try c.decodeIfPresent(String.self, forKey: .credential)
    }
  }

  let projectId: String
  let apiKey: String
  let uid: String
  let circleId: String
  let shareId: String
  let idToken: String
  let refreshToken: String
  let tokenExpiresAt: Double  // ms
  let createdAt: Double  // ms
  let iceServers: [IceServer]

  static let appGroup = "group.com.amethos.mytechkid"
  static let key = "shareRequest"

  /// Reads the request once and forgets it, so the sign-in it carries doesn't linger.
  static func take() -> ShareRequest? {
    guard let defaults = UserDefaults(suiteName: appGroup) else { return nil }
    let text = defaults.string(forKey: key)
    defaults.removeObject(forKey: key)
    guard let data = text?.data(using: .utf8),
          let request = try? JSONDecoder().decode(ShareRequest.self, from: data) else { return nil }
    // Only one Mom just asked for: the helper's join window is 10 minutes.
    let age = Date().timeIntervalSince1970 - request.createdAt / 1000
    return age >= 0 && age < ShareSession.joinWindow ? request : nil
  }
}

final class ShareSession: NSObject {
  static let joinWindow: TimeInterval = 10 * 60
  private static let maxShare: TimeInterval = 60 * 60
  private static let maxReconnects = 20
  private static let maxBitrate = 2_500_000
  /// About 580 x 1260 on most iPhones: sharp enough to read, light enough
  /// for Apple's 50 MB memory limit on broadcast add-ons (iOS ends the
  /// broadcast without a word when it goes over).
  private static let maxPixels = 730_000.0
  /// Pictures a second. ReplayKit can send 60; extra ones are dropped here,
  /// before WebRTC makes a scaled copy of each.
  private static let fps = 20.0
  private static let firstGen = "first"

  // H.264 only: iPhones encode it in hardware, which keeps the add-on small.
  private static let factory: RTCPeerConnectionFactory = {
    _ = RTCInitializeSSL()
    return RTCPeerConnectionFactory(encoderFactory: RTCVideoEncoderFactoryH264(), decoderFactory: RTCVideoDecoderFactoryH264())
  }()

  private let queue: DispatchQueue
  private let request: ShareRequest
  private let store: Firestore
  private let onEnd: (String) -> Void
  private let source: RTCVideoSource
  private let capturer: RTCVideoCapturer
  private let track: RTCVideoTrack
  private var sized = false
  private var lastFrame = 0.0

  private var pc: RTCPeerConnection?
  private var control: RTCDataChannel?
  private var fast: RTCDataChannel?
  private var gen = ""
  private var reconnects = 0
  private var live = false
  private var stopped = false
  private var remoteSet = false
  private var connected = false
  private var outbox: [(String, String)] = []
  private var pending: [RTCIceCandidate] = []
  private var seen = Set<String>()
  private var since: String?
  private var checkingStatus = false
  private var checkingSignals = false
  private var lastSignalCheck = Date.distantPast
  private var timer: DispatchSourceTimer?
  private let startedAt = Date()

  private var sharePath: String { "circles/\(request.circleId)/screenShares/\(request.shareId)" }

  /// `onEnd` asks Apple to stop the broadcast, with a note for Mom.
  init(request: ShareRequest, onEnd: @escaping (String) -> Void) {
    let queue = DispatchQueue(label: "com.amethos.mytechkid.share")
    self.queue = queue
    self.request = request
    self.onEnd = onEnd
    store = Firestore(
      projectId: request.projectId,
      apiKey: request.apiKey,
      idToken: request.idToken,
      refreshToken: request.refreshToken,
      expiresAt: Date(timeIntervalSince1970: request.tokenExpiresAt / 1000),
      queue: queue
    )
    source = Self.factory.videoSource(forScreenCast: true)
    capturer = RTCVideoCapturer(delegate: source)
    track = Self.factory.videoTrack(with: source, trackId: "screen")
    super.init()
  }

  func start() {
    queue.async { [self] in
      // Ready before the helper joins, so the picture shows the moment they do.
      connect(Self.firstGen)
      let timer = DispatchSource.makeTimerSource(queue: queue)
      timer.schedule(deadline: .now(), repeating: .milliseconds(500))
      timer.setEventHandler { [weak self] in self?.tick() }
      timer.resume()
      self.timer = timer
    }
  }

  /// One picture of the screen, from ReplayKit's thread.
  func push(_ sample: CMSampleBuffer) {
    let time = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample))
    guard time - lastFrame >= 0.9 / Self.fps, let pixels = CMSampleBufferGetImageBuffer(sample) else { return }
    lastFrame = time
    if !sized {
      // Same shape as the screen (no cropping), smaller if it's big.
      sized = true
      let width = Double(CVPixelBufferGetWidth(pixels))
      let height = Double(CVPixelBufferGetHeight(pixels))
      let scale = min(1, (Self.maxPixels / max(1, width * height)).squareRoot())
      let even = { (v: Double) in Int32(v * scale / 2) * 2 }
      source.adaptOutputFormat(toWidth: even(width), height: even(height), fps: Int32(Self.fps))
    }
    var rotation = RTCVideoRotation._0
    if let raw = CMGetAttachment(sample, key: RPVideoSampleOrientationKey as CFString, attachmentModeOut: nil) as? NSNumber,
       let orientation = CGImagePropertyOrientation(rawValue: raw.uint32Value) {
      switch orientation {
      case .left: rotation = ._90
      case .down: rotation = ._180
      case .right: rotation = ._270
      default: break
      }
    }
    let frame = RTCVideoFrame(
      buffer: RTCCVPixelBuffer(pixelBuffer: pixels),
      rotation: rotation,
      timeStampNs: Int64(time * 1_000_000_000)
    )
    source.capturer(capturer, didCapture: frame)
  }

  /// Mom stopped the broadcast (red bar or Control Center): tell the helper's
  /// page before iOS closes the add-on.
  func finish() {
    let done = DispatchSemaphore(value: 0)
    queue.async { [self] in
      stop(endShare: true, note: nil) { _ = done.signal() }
    }
    _ = done.wait(timeout: .now() + 3)
  }

  // MARK: - Watching the share

  private func tick() {
    guard !stopped else { return }
    if !live && Date().timeIntervalSince1970 - request.createdAt / 1000 > Self.joinWindow {
      return stop(endShare: true, note: "Nobody opened your screen, so sharing stopped.")
    }
    if Date().timeIntervalSince(startedAt) > Self.maxShare {
      return stop(endShare: true, note: "Sharing stops after an hour. Open My Tech Kid to share again.")
    }
    checkStatus()
    // Quick while connecting; slower once the picture flows (only a page
    // reload sends anything new then).
    let every: TimeInterval = connected ? 1.5 : 0.5
    if live && Date().timeIntervalSince(lastSignalCheck) >= every { checkSignals() }
  }

  private func checkStatus() {
    guard !checkingStatus else { return }
    checkingStatus = true
    store.get(sharePath) { [self] doc in
      checkingStatus = false
      // No answer (a network blip): try again on the next tick.
      guard let doc, !stopped else { return }
      switch doc.string("status") {
      case "live":
        if !live {
          live = true
          flushOutbox()
        }
      case "ended":
        stop(endShare: false, note: "Your screen share ended.")
      default:
        break
      }
    }
  }

  private func checkSignals() {
    guard !checkingSignals else { return }
    checkingSignals = true
    lastSignalCheck = Date()
    store.list(sharePath, "signals", orderedBy: "createdAt", since: since) { [self] docs in
      checkingSignals = false
      guard let docs, !stopped else { return }
      for doc in docs {
        if let time = doc.timestamp("createdAt") { since = time }
        handle(doc)
      }
    }
  }

  private func handle(_ doc: Firestore.Doc) {
    guard !seen.contains(doc.id) else { return }
    seen.insert(doc.id)
    guard doc.string("from") != request.uid,
          let text = doc.string("payload"),
          let payload = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any] else { return }
    let type = doc.string("type")
    // The helper's page reloaded: start a fresh connection for it.
    if type == "hello" {
      let newGen = String((payload["gen"] as? String ?? "").prefix(40))
      if !newGen.isEmpty && newGen != gen && reconnects < Self.maxReconnects {
        reconnects += 1
        connect(newGen)
      }
      return
    }
    // Messages for an older connection (before a reload) are ignored.
    guard (payload["gen"] as? String ?? Self.firstGen) == gen, let pc else { return }
    if type == "answer", let sdp = payload["sdp"] as? String {
      pc.setRemoteDescription(RTCSessionDescription(type: .answer, sdp: sdp)) { [self] error in
        queue.async { [self] in
          guard error == nil, pc === self.pc else { return }
          remoteSet = true
          pending.forEach { pc.add($0) { _ in } }
          pending = []
        }
      }
    } else if type == "candidate", let line = payload["candidate"] as? String, !line.isEmpty {
      let index = (payload["sdpMLineIndex"] as? NSNumber)?.int32Value ?? 0
      let candidate = RTCIceCandidate(sdp: line, sdpMLineIndex: index, sdpMid: payload["sdpMid"] as? String)
      if remoteSet {
        pc.add(candidate) { _ in }
      } else {
        pending.append(candidate)
      }
    }
  }

  private func sendSignal(_ type: String, _ payload: [String: Any]) {
    guard !stopped,
          let data = try? JSONSerialization.data(withJSONObject: payload),
          let text = String(data: data, encoding: .utf8) else { return }
    // The rules only take setup messages once the helper has joined.
    guard live else { return outbox.append((type, text)) }
    store.add("\(sharePath)/signals", ["from": request.uid, "type": type, "payload": text], timeField: "createdAt") { _ in }
  }

  private func flushOutbox() {
    let waiting = outbox
    outbox = []
    waiting.forEach { type, text in
      store.add("\(sharePath)/signals", ["from": request.uid, "type": type, "payload": text], timeField: "createdAt") { _ in }
    }
  }

  // MARK: - The connection

  private func connect(_ newGen: String) {
    guard !stopped else { return }
    closeConnection()
    gen = newGen
    let config = RTCConfiguration()
    config.iceServers = request.iceServers.map {
      RTCIceServer(urlStrings: $0.urls, username: $0.username, credential: $0.credential)
    }
    config.sdpSemantics = .unifiedPlan
    config.iceCandidatePoolSize = 2
    let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
    let made: RTCPeerConnection? = Self.factory.peerConnection(with: config, constraints: constraints, delegate: self)
    guard let pc = made else { return }
    self.pc = pc

    let added: RTCRtpSender? = pc.add(track, streamIds: ["screen"])
    if let sender = added {
      let parameters = sender.parameters
      parameters.encodings.forEach { $0.maxBitrateBps = NSNumber(value: Self.maxBitrate) }
      sender.parameters = parameters
    }

    // Made before the offer so they're part of the same encrypted connection.
    control = pc.dataChannel(forLabel: "control", configuration: RTCDataChannelConfiguration())
    control?.delegate = self
    let unreliable = RTCDataChannelConfiguration()
    unreliable.isOrdered = false
    unreliable.maxRetransmits = 0
    fast = pc.dataChannel(forLabel: "fast", configuration: unreliable)
    fast?.delegate = self

    pc.offer(for: constraints) { [weak self] offer, _ in
      guard let self, let offer else { return }
      self.queue.async {
        guard pc === self.pc else { return }
        pc.setLocalDescription(offer) { error in
          self.queue.async {
            guard error == nil, pc === self.pc else { return }
            self.sendSignal("offer", ["sdp": offer.sdp, "gen": newGen])
          }
        }
      }
    }
  }

  private func closeConnection() {
    control?.close()
    fast?.close()
    pc?.close()
    control = nil
    fast = nil
    pc = nil
    remoteSet = false
    connected = false
    pending = []
  }

  private func stop(endShare: Bool, note: String?, then: (() -> Void)? = nil) {
    guard !stopped else { then?(); return }
    stopped = true
    timer?.cancel()
    timer = nil
    closeConnection()
    let finish = { [self] in
      if let note { onEnd(note) }
      then?()
    }
    if endShare {
      store.update(sharePath, ["status": "ended", "endedBy": request.uid], timeField: "endedAt") { _ in finish() }
    } else {
      finish()
    }
  }

  private func send(_ message: [String: Any], on channel: RTCDataChannel?) {
    guard let channel, channel.readyState == .open,
          let data = try? JSONSerialization.data(withJSONObject: message) else { return }
    _ = channel.sendData(RTCDataBuffer(data: data, isBinary: false))
  }
}

extension ShareSession: RTCPeerConnectionDelegate {
  func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
    queue.async { [self] in
      guard peerConnection === pc else { return }
      var payload: [String: Any] = ["candidate": candidate.sdp, "sdpMLineIndex": candidate.sdpMLineIndex, "gen": gen]
      if let mid = candidate.sdpMid { payload["sdpMid"] = mid }
      sendSignal("candidate", payload)
    }
  }

  func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
    queue.async { [self] in
      guard peerConnection === pc else { return }
      connected = newState == .connected || newState == .completed
    }
  }

  func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
  func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
  func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
}

extension ShareSession: RTCDataChannelDelegate {
  func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {
    queue.async { [self] in
      // No tapping on iPhone: only pings, so the helper's page knows the link is alive.
      if dataChannel === control && dataChannel.readyState == .open {
        send(["t": "caps", "ping": true, "fast": true], on: dataChannel)
      }
    }
  }

  func dataChannel(_ dataChannel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {
    guard let message = (try? JSONSerialization.jsonObject(with: buffer.data)) as? [String: Any],
          message["t"] as? String == "ping" else { return }
    queue.async { [self] in send(["t": "pong"], on: dataChannel) }
  }
}
