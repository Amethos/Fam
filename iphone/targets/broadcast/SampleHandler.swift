import ReplayKit

// Runs inside Apple's broadcast while Mom shares her screen, for as long as
// the red bar shows (the app itself is paused while she's in other apps).
// It sends the screen straight to her helper (ShareSession); nothing is saved.

class SampleHandler: RPBroadcastSampleHandler {
  private var session: ShareSession?

  override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
    ShareLog.add("broadcast started")
    // Only a share Mom just started in the app, never one from Control Center alone.
    guard let request = ShareRequest.take() else {
      finishBroadcastWithError(Self.note("Open My Tech Kid and tap Share my screen to start."))
      return
    }
    let session = ShareSession(request: request) { [weak self] message in
      self?.finishBroadcastWithError(Self.note(message))
    }
    self.session = session
    session.start()
  }

  override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
    guard sampleBufferType == .video else { return }
    session?.push(sampleBuffer)
  }

  override func broadcastFinished() {
    ShareLog.add("broadcast finished")
    session?.finish()
  }

  /// iOS shows this to Mom when the broadcast stops.
  private static func note(_ message: String) -> NSError {
    NSError(domain: RPRecordingErrorDomain, code: 10001, userInfo: [NSLocalizedDescriptionKey: message])
  }
}
