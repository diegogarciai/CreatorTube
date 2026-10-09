import PhotosUI
import SwiftUI

/// Cuadrícula de fotos con subir (PhotosPicker) y borrar. Se usa para las fotos
/// del presentador del canal y las fotos de producto de un episodio.
struct PhotoGridView: View {
    let title: String
    let footer: String
    let max: Int
    let canEdit: Bool
    let load: () async throws -> [MediaRow]
    let add: (Data) async throws -> Void
    let delete: (MediaRow) async throws -> Void

    @Environment(AppModel.self) private var model
    @State private var photos: [MediaRow] = []
    @State private var urls: [String: URL] = [:]
    @State private var picked: PhotosPickerItem?
    @State private var isUploading = false
    @State private var errorMessage: String?

    var body: some View {
        Section {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 8)], spacing: 8) {
                ForEach(photos) { photo in
                    AsyncImage(url: urls[photo.path]) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        Palette.surfaceMuted
                    }
                    .frame(height: 96)
                    .frame(maxWidth: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .contextMenu {
                        if canEdit {
                            Button("Borrar", role: .destructive) { remove(photo) }
                        }
                    }
                    .accessibilityLabel(photo.label ?? "Foto")
                }
                if canEdit && photos.count < max {
                    PhotosPicker(selection: $picked, matching: .images) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 8).stroke(Palette.border, style: StrokeStyle(lineWidth: 1, dash: [4]))
                            if isUploading { ProgressView() } else { Image(systemName: "plus").font(.title2) }
                        }
                        .frame(height: 96)
                    }
                    .disabled(isUploading)
                    .accessibilityLabel("Subir foto")
                }
            }
            .padding(.vertical, 4)
            if let errorMessage {
                Text(errorMessage).font(.footnote).foregroundStyle(Palette.critical)
            }
        } header: {
            Text("\(title) (\(photos.count)/\(max))")
        } footer: {
            Text(footer + (canEdit && !photos.isEmpty ? " Mantén pulsada una foto para borrarla." : ""))
        }
        .task { await reload() }
        .onChange(of: picked) { _, item in
            guard let item else { return }
            Task { await upload(item) }
        }
    }

    private func reload() async {
        do {
            photos = try await load()
            for photo in photos where urls[photo.path] == nil {
                urls[photo.path] = await model.signedURL(photo.path)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func upload(_ item: PhotosPickerItem) async {
        isUploading = true
        errorMessage = nil
        defer {
            isUploading = false
            picked = nil
        }
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else { throw MediaError.unreadable }
            try await add(data)
            await reload()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func remove(_ photo: MediaRow) {
        Task {
            do {
                try await delete(photo)
                await reload()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}
