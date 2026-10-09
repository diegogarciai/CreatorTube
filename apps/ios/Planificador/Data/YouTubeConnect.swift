import AuthenticationServices
import Foundation
import UIKit

/// Conectar un canal con YouTube desde la app. El servidor da un enlace con un
/// ticket que vence en 5 minutos (`youtubeConnectLink`); la app lo abre en un
/// navegador del sistema, la persona autoriza en Google y el servidor vuelve a
/// `planificador://youtube` con el canal conectado o el motivo del error. Los
/// tokens de Google se quedan en el servidor, como en la web.
extension AppModel {
    struct YouTubeConnection {
        let channelId: String
        let isNew: Bool
    }

    /// Reconecta un canal existente (`channelId`) o crea uno nuevo en un
    /// espacio (`workspaceId`); con `scope: "comments"` pide además el permiso
    /// para responder comentarios. Si la persona cierra la hoja de Google, lanza
    /// `CancellationError`.
    @discardableResult
    func connectYouTube(channelId: String? = nil, workspaceId: String? = nil, scope: String? = nil) async throws -> YouTubeConnection {
        var target: [String: JSONAny] = [:]
        if let channelId { target["channelId"] = .string(channelId) }
        if let workspaceId { target["workspaceId"] = .string(workspaceId) }
        // "comments": además el permiso para responder comentarios.
        if let scope { target["scope"] = .string(scope) }
        guard let link = try await ServerAPI.call("youtubeConnectLink", [.object(target)], as: ConnectLink.self),
              let url = URL(string: link.url) else {
            throw ActionFailure(key: "errors.unknown")
        }

        let callback = try await YouTubeAuthSession().start(url: url)
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let value = { (name: String) in items.first { $0.name == name }?.value }

        if let reason = value("error") {
            throw ActionFailure(key: "errors.\(reason)")
        }
        guard let connected = value("channel") else { throw ActionFailure(key: "errors.youtube_error") }

        await loadWorkspace()
        await selectChannel(connected)
        return YouTubeConnection(channelId: connected, isNew: value("new") == "1")
    }

    private struct ConnectLink: Decodable {
        let url: String
    }
}

/// `ASWebAuthenticationSession` con async/await. Comparte las cookies de
/// Safari, así que si la persona ya entró a Google no tiene que volver a hacerlo.
@MainActor
private final class YouTubeAuthSession: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let callbackScheme = "planificador"
    /// Se guarda mientras dura la autorización.
    private var session: ASWebAuthenticationSession?

    func start(url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let completion: ASWebAuthenticationSession.CompletionHandler = { [weak self] callbackURL, error in
                self?.session = nil
                if let error {
                    if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
                        continuation.resume(throwing: CancellationError())
                    } else {
                        continuation.resume(throwing: error)
                    }
                } else if let callbackURL {
                    continuation.resume(returning: callbackURL)
                } else {
                    continuation.resume(throwing: ActionFailure(key: "errors.youtube_error"))
                }
            }
            let session: ASWebAuthenticationSession
            if #available(iOS 17.4, *) {
                session = ASWebAuthenticationSession(url: url, callback: .customScheme(Self.callbackScheme),
                                                     completionHandler: completion)
            } else {
                session = ASWebAuthenticationSession(url: url, callbackURLScheme: Self.callbackScheme,
                                                     completionHandler: completion)
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            if !session.start() {
                self.session = nil
                continuation.resume(throwing: ActionFailure(key: "errors.youtube_error"))
            }
        }
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            return scenes.flatMap(\.windows).first { $0.isKeyWindow } ?? ASPresentationAnchor()
        }
    }
}
