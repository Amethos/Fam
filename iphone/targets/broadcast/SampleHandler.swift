import ReplayKit

// Runs inside Apple's broadcast while Mom shares her screen. It only passes
// pictures to the My Tech Kid app on the same phone; nothing is saved.
// Adapted from Jitsi Meet's broadcast extension (Apache 2.0), which
// react-native-webrtc's ScreenCapturer is built to receive.

private enum Constants {
  static let appGroupIdentifier = "group.com.amethos.mytechkid"
  // Every other picture: about 30 a second, which keeps the add-on well
  // under Apple's memory limit for broadcast extensions.
  static let sendEvery = 2
}

class SampleHandler: RPBroadcastSampleHandler {
  private var connection: SocketConnection?
  private var uploader: SampleUploader?
  private var frameCount = 0

  private var socketFilePath: String {
    let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Constants.appGroupIdentifier)
    return container?.appendingPathComponent("rtc_SSFD").path ?? ""
  }

  override init() {
    super.init()
    if let connection = SocketConnection(filePath: socketFilePath) {
      self.connection = connection
      setupConnection()
      uploader = SampleUploader(connection: connection)
    }
  }

  override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
    frameCount = 0
    openConnection()
  }

  override func broadcastFinished() {
    connection?.close()
  }

  override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
    guard sampleBufferType == .video else { return }
    frameCount += 1
    if frameCount % Constants.sendEvery == 0 {
      uploader?.send(sample: sampleBuffer)
    }
  }

  private func setupConnection() {
    connection?.didClose = { [weak self] error in
      // The app stopped sharing (Mom tapped Stop, or the share ended).
      let reason = error ?? NSError(
        domain: RPRecordingErrorDomain,
        code: 10001,
        userInfo: [NSLocalizedDescriptionKey: "My Tech Kid stopped sharing your screen."]
      )
      self?.finishBroadcastWithError(reason)
    }
  }

  /// The app may still be getting ready, so keep trying for a moment.
  private func openConnection() {
    let queue = DispatchQueue(label: "broadcast.connectTimer")
    let timer = DispatchSource.makeTimerSource(queue: queue)
    var tries = 0
    timer.schedule(deadline: .now(), repeating: .milliseconds(100), leeway: .milliseconds(500))
    timer.setEventHandler { [weak self] in
      tries += 1
      if self?.connection?.open() == true || tries > 100 {
        timer.cancel()
      }
    }
    timer.resume()
  }
}
