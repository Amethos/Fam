import Foundation

// Just enough of Firestore's web API for the broadcast add-on. It uses the
// app's own sign-in, handed over for this one share, so firestore.rules
// apply exactly as they do to the app: it can only touch this share.

final class Firestore {
  struct Doc {
    let id: String
    let fields: [String: Any]

    func string(_ key: String) -> String? {
      (fields[key] as? [String: Any])?["stringValue"] as? String
    }

    func timestamp(_ key: String) -> String? {
      (fields[key] as? [String: Any])?["timestampValue"] as? String
    }
  }

  private let projectId: String
  private let apiKey: String
  private var idToken: String
  private let refreshToken: String
  private var expiresAt: Date
  private var waitingForToken: [(String?) -> Void] = []
  private let queue: DispatchQueue
  private let http = URLSession(configuration: .ephemeral)

  /// Callbacks run on `queue`.
  init(projectId: String, apiKey: String, idToken: String, refreshToken: String, expiresAt: Date, queue: DispatchQueue) {
    self.projectId = projectId
    self.apiKey = apiKey
    self.idToken = idToken
    self.refreshToken = refreshToken
    self.expiresAt = expiresAt
    self.queue = queue
  }

  /// Document names start with this.
  var root: String { "projects/\(projectId)/databases/(default)/documents" }

  func get(_ path: String, done: @escaping (Doc?) -> Void) {
    send("GET", "\(root)/\(path)", body: nil) { json in
      guard let json = json as? [String: Any] else { return done(nil) }
      done(Doc(id: path, fields: json["fields"] as? [String: Any] ?? [:]))
    }
  }

  /// A subcollection's documents, oldest first, from `since` (inclusive) on.
  func list(_ parent: String, _ collection: String, orderedBy field: String, since: String?, done: @escaping ([Doc]?) -> Void) {
    var query: [String: Any] = [
      "from": [["collectionId": collection]],
      "orderBy": [["field": ["fieldPath": field], "direction": "ASCENDING"] as [String: Any]],
    ]
    if let since {
      let filter: [String: Any] = [
        "field": ["fieldPath": field],
        "op": "GREATER_THAN_OR_EQUAL",
        "value": ["timestampValue": since],
      ]
      query["where"] = ["fieldFilter": filter]
    }
    send("POST", "\(root)/\(parent):runQuery", body: ["structuredQuery": query]) { json in
      guard let rows = json as? [[String: Any]] else { return done(nil) }
      done(rows.compactMap { row in
        guard let doc = row["document"] as? [String: Any], let name = doc["name"] as? String else { return nil }
        return Doc(id: String(name.split(separator: "/").last ?? ""), fields: doc["fields"] as? [String: Any] ?? [:])
      })
    }
  }

  /// Adds a document with the given text fields, stamped with the server's time.
  func add(_ collectionPath: String, _ fields: [String: String], timeField: String, done: @escaping (Bool) -> Void) {
    commit([
      "update": ["name": "\(root)/\(collectionPath)/\(Self.newId())", "fields": Self.encode(fields)] as [String: Any],
      "updateTransforms": [["fieldPath": timeField, "setToServerValue": "REQUEST_TIME"]],
      "currentDocument": ["exists": false],
    ], done: done)
  }

  /// Changes the given text fields of an existing document, stamping `timeField` with the server's time.
  func update(_ path: String, _ fields: [String: String], timeField: String, done: @escaping (Bool) -> Void) {
    commit([
      "update": ["name": "\(root)/\(path)", "fields": Self.encode(fields)] as [String: Any],
      "updateMask": ["fieldPaths": Array(fields.keys)],
      "updateTransforms": [["fieldPath": timeField, "setToServerValue": "REQUEST_TIME"]],
      "currentDocument": ["exists": true],
    ], done: done)
  }

  private func commit(_ write: [String: Any], done: @escaping (Bool) -> Void) {
    send("POST", "\(root):commit", body: ["writes": [write]]) { json in done(json != nil) }
  }

  private static func encode(_ fields: [String: String]) -> [String: Any] {
    fields.mapValues { ["stringValue": $0] }
  }

  private static func newId() -> String {
    let letters = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")
    return String((0..<20).map { _ in letters.randomElement()! })
  }

  private func send(_ method: String, _ path: String, body: Any?, done: @escaping (Any?) -> Void) {
    withToken { [self] token in
      guard let token, let url = URL(string: "https://firestore.googleapis.com/v1/\(path)") else { return done(nil) }
      var request = URLRequest(url: url, timeoutInterval: 15)
      request.httpMethod = method
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
      if let body {
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
      }
      http.dataTask(with: request) { data, response, error in
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        let ok = (200..<300).contains(code)
        let json = ok ? data.flatMap { try? JSONSerialization.jsonObject(with: $0) } : nil
        if !ok {
          // Firestore's own error text (no sign-in in it), for the share diary.
          let detail = error?.localizedDescription ?? data.flatMap { String(data: $0.prefix(200), encoding: .utf8) } ?? ""
          ShareLog.add("Firestore \(method) \(path.split(separator: "/").suffix(2).joined(separator: "/")) failed \(code): \(detail)")
        }
        self.queue.async { done(json) }
      }.resume()
    }
  }

  /// The sign-in lasts an hour; get a fresh one a few minutes before it runs out.
  private func withToken(_ use: @escaping (String?) -> Void) {
    if expiresAt.timeIntervalSinceNow > 300 { return use(idToken) }
    waitingForToken.append(use)
    if waitingForToken.count > 1 { return }
    guard let url = URL(string: "https://securetoken.googleapis.com/v1/token?key=\(apiKey)") else { return finishRefresh(ok: false) }
    var request = URLRequest(url: url, timeoutInterval: 15)
    request.httpMethod = "POST"
    request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
    var form = URLComponents()
    form.queryItems = [
      URLQueryItem(name: "grant_type", value: "refresh_token"),
      URLQueryItem(name: "refresh_token", value: refreshToken),
    ]
    request.httpBody = form.percentEncodedQuery?.data(using: .utf8)
    http.dataTask(with: request) { data, _, _ in
      let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
      self.queue.async {
        ShareLog.add(json?["id_token"] is String ? "sign-in refreshed" : "sign-in refresh failed")
        if let token = json?["id_token"] as? String {
          self.idToken = token
          let seconds = Double(json?["expires_in"] as? String ?? "") ?? 3600
          self.expiresAt = Date().addingTimeInterval(seconds)
          self.finishRefresh(ok: true)
        } else {
          self.finishRefresh(ok: false)
        }
      }
    }.resume()
  }

  private func finishRefresh(ok: Bool) {
    let waiting = waitingForToken
    waitingForToken = []
    waiting.forEach { $0(ok ? idToken : nil) }
  }
}
