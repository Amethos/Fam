import Foundation

// A short diary of recent shares, kept only on this phone (in the app group,
// so the app's test screen can show it). Steps and numbers only: never what's
// on the screen, and never the sign-in.

enum ShareLog {
  private static let key = "shareLog"
  private static let maxLines = 300
  private static let lock = NSLock()
  private static let clock: DateFormatter = {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "HH:mm:ss.SSS"
    return f
  }()

  static func add(_ line: String) {
    lock.lock()
    defer { lock.unlock() }
    guard let defaults = UserDefaults(suiteName: ShareRequest.appGroup) else { return }
    var lines = (defaults.string(forKey: key) ?? "").split(separator: "\n", omittingEmptySubsequences: true).map(String.init)
    lines.append("\(clock.string(from: Date())) add-on: \(line)")
    defaults.set(lines.suffix(maxLines).joined(separator: "\n"), forKey: key)
  }

  /// How much memory the add-on uses, in MB (iOS stops it past about 50).
  static func memoryMB() -> Double {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<natural_t>.size)
    let result = withUnsafeMutablePointer(to: &info) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
        task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
      }
    }
    return result == KERN_SUCCESS ? Double(info.phys_footprint) / 1_048_576 : -1
  }
}
