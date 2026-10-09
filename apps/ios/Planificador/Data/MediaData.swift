import Foundation
import Supabase
import UIKit

/// Fotos del presentador y fotos de producto del episodio: la app sube el
/// archivo directo al bucket (las políticas de Storage revisan el permiso) y
/// registra la ruta, igual que la web (`lib/upload.ts` + `brand.ts`/`thumbnails.ts`).

let presenterPhotosMax = 8
let episodeRefsMax = 3
let mediaMaxBytes = 10 * 1024 * 1024

struct MediaRow: Decodable, Identifiable, Hashable {
    let id: String
    let path: String
    let label: String?
}

struct PresenterPhotoInsert: Encodable {
    let channelId: String
    let path: String
    let label: String?

    enum CodingKeys: String, CodingKey {
        case path, label
        case channelId = "channel_id"
    }
}

struct EpisodeRefInsert: Encodable {
    let episodeId: String
    let channelId: String
    let path: String
    let label: String?

    enum CodingKeys: String, CodingKey {
        case path, label
        case episodeId = "episode_id"
        case channelId = "channel_id"
    }
}

enum MediaError: LocalizedError {
    case tooMany(Int)
    case tooBig
    case unreadable

    var errorDescription: String? {
        switch self {
        case .tooMany(let max): return "Ya hay \(max) fotos: borra una para subir otra."
        case .tooBig: return "La foto pesa más de 10 MB."
        case .unreadable: return "No se pudo leer la foto."
        }
    }
}

/// JPEG de hasta 2048 px de lado, para que la foto suba rápido y quepa en el límite.
func jpegForUpload(_ data: Data) throws -> Data {
    guard let image = UIImage(data: data) else { throw MediaError.unreadable }
    let maxSide: CGFloat = 2048
    let scale = min(1, maxSide / max(image.size.width, image.size.height))
    let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in
        image.draw(in: CGRect(origin: .zero, size: size))
    }
    guard let jpeg = resized.jpegData(compressionQuality: 0.85) else { throw MediaError.unreadable }
    guard jpeg.count <= mediaMaxBytes else { throw MediaError.tooBig }
    return jpeg
}

extension AppModel {
    private func upload(_ jpeg: Data, to path: String) async throws {
        guard let client = supabase else { throw AppError.notReady }
        _ = try await client.storage.from(mediaBucket)
            .upload(path, data: jpeg, options: FileOptions(contentType: "image/jpeg"))
    }

    private func removeFile(_ path: String) async {
        _ = try? await supabase?.storage.from(mediaBucket).remove(paths: [path])
    }

    func signedURL(_ path: String) async -> URL? {
        try? await supabase?.storage.from(mediaBucket).createSignedURL(path: path, expiresIn: signedURLSeconds)
    }

    // MARK: Fotos del presentador (configure_channel)

    func presenterPhotos() async throws -> [MediaRow] {
        guard let client = supabase, let channelId = selectedChannelId else { return [] }
        return try await client.from("presenter_photos").select("id, path, label")
            .eq("channel_id", value: channelId).order("created_at").execute().value
    }

    func addPresenterPhoto(_ data: Data, label: String?) async throws {
        guard let client = supabase, let channelId = selectedChannelId else { throw AppError.notReady }
        guard can(.configureChannel) else { throw AppError.forbiddenEdit }
        guard try await presenterPhotos().count < presenterPhotosMax else { throw MediaError.tooMany(presenterPhotosMax) }
        let jpeg = try jpegForUpload(data)
        let path = "\(channelId)/presenter/\(UUID().uuidString.lowercased()).jpg"
        try await upload(jpeg, to: path)
        do {
            try await client.from("presenter_photos")
                .insert(PresenterPhotoInsert(channelId: channelId, path: path, label: label))
                .execute()
        } catch {
            await removeFile(path)
            throw error
        }
    }

    func deletePresenterPhoto(_ photo: MediaRow) async throws {
        guard let client = supabase else { throw AppError.notReady }
        guard can(.configureChannel) else { throw AppError.forbiddenEdit }
        try await client.from("presenter_photos").delete().eq("id", value: photo.id).execute()
        await removeFile(photo.path)
    }

    // MARK: Fotos de producto del episodio (write_script)

    func episodeRefs(_ episodeId: String) async throws -> [MediaRow] {
        guard let client = supabase else { return [] }
        return try await client.from("episode_refs").select("id, path, label")
            .eq("episode_id", value: episodeId).order("created_at").execute().value
    }

    func addEpisodeRef(_ episodeId: String, data: Data, label: String?) async throws {
        guard let client = supabase, let channelId = selectedChannelId else { throw AppError.notReady }
        guard can(.writeScript) else { throw AppError.forbiddenEdit }
        guard try await episodeRefs(episodeId).count < episodeRefsMax else { throw MediaError.tooMany(episodeRefsMax) }
        let jpeg = try jpegForUpload(data)
        let path = "\(channelId)/episodes/\(episodeId)/refs/\(UUID().uuidString.lowercased()).jpg"
        try await upload(jpeg, to: path)
        do {
            try await client.from("episode_refs")
                .insert(EpisodeRefInsert(episodeId: episodeId, channelId: channelId, path: path, label: label))
                .execute()
        } catch {
            await removeFile(path)
            throw error
        }
    }

    func deleteEpisodeRef(_ ref: MediaRow) async throws {
        guard let client = supabase else { throw AppError.notReady }
        guard can(.writeScript) else { throw AppError.forbiddenEdit }
        try await client.from("episode_refs").delete().eq("id", value: ref.id).execute()
        await removeFile(ref.path)
    }
}
