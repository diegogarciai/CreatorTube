import Supabase
import SwiftUI

/// Entrar con el código que llega por correo (el mismo correo del enlace
/// mágico de la web). No necesita URL de retorno, así que funciona sin
/// configurar nada más en Supabase.
struct LoginView: View {
    private enum Step {
        case email, code
    }

    @State private var step: Step = .email
    @State private var email = ""
    @State private var code = ""
    @State private var isWorking = false
    @State private var errorMessage: String?
    @State private var info: String?
    @FocusState private var focused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                LogoView(size: 48)
                    .padding(.top, 48)

                VStack(alignment: .leading, spacing: 6) {
                    Text("Entrar")
                        .font(.largeTitle.bold())
                    Text("Recibe un código por correo para entrar.")
                        .foregroundStyle(Palette.muted)
                }

                switch step {
                case .email: emailStep
                case .code: codeStep
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(Palette.critical)
                }

                Text("Solo pueden entrar personas invitadas.")
                    .font(.footnote)
                    .foregroundStyle(Palette.muted)
            }
            .padding(24)
        }
        .background(Palette.background)
    }

    private var emailStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextField("Correo", text: $email)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($focused)
                .submitLabel(.send)
                .onSubmit { Task { await sendCode() } }
                .padding(12)
                .background(Palette.surface, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Palette.border))

            Button {
                Task { await sendCode() }
            } label: {
                Text("Enviarme un código")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(isWorking || !email.contains("@"))
        }
    }

    private var codeStep: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let info {
                Text(info).font(.callout)
            }

            TextField("Código del correo", text: $code)
                .textContentType(.oneTimeCode)
                .keyboardType(.numberPad)
                .font(.title3.monospacedDigit())
                .focused($focused)
                .padding(12)
                .background(Palette.surface, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Palette.border))
                .onChange(of: code) { _, value in
                    let digits = String(value.filter(\.isNumber).prefix(10))
                    if digits != value { code = digits }
                }

            Button {
                Task { await verify() }
            } label: {
                Text("Entrar con el código")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(isWorking || code.count < 6)

            Button("Usar otro correo o pedir otro código") {
                step = .email
                code = ""
                errorMessage = nil
            }
            .font(.footnote)
        }
    }

    private func sendCode() async {
        guard let client = supabase else { return }
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard address.contains("@") else { return }
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            try await client.auth.signInWithOTP(email: address)
            email = address
            info = "Revisa tu correo: te enviamos un código para entrar. Escríbelo aquí."
            step = .code
            focused = true
        } catch {
            errorMessage = Self.sendErrorMessage(error)
        }
    }

    private func verify() async {
        guard let client = supabase else { return }
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            // AppModel recibe la sesión por `authStateChanges`.
            _ = try await client.auth.verifyOTP(email: email, token: code.trimmingCharacters(in: .whitespaces), type: .email)
        } catch {
            errorMessage = "El código no es válido o ya venció. Pide uno nuevo."
        }
    }

    /// Mismo mapeo de errores que `login-form.tsx`.
    static func sendErrorMessage(_ error: Error) -> String {
        let message = "\(error.localizedDescription) \(String(describing: error))"
        if message.range(of: "invit", options: .caseInsensitive) != nil {
            return "Este correo no tiene invitación. Pide un enlace de invitación a quien administra la plataforma."
        }
        if message.range(of: #"security purposes|rate limit|after \d+ seconds"#, options: [.regularExpression, .caseInsensitive]) != nil {
            return "Ya te enviamos un correo hace poco. Espera un minuto antes de pedir otro."
        }
        return error.localizedDescription
    }
}

/// Pantalla cuando la app no tiene la URL o la clave de Supabase, o la URL
/// llegó mal escrita. Muestra lo que leyó para que el error sea evidente.
struct ConfigMissingView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                LogoView(size: 48)
                Text("Falta configurar Supabase")
                    .font(.title2.bold())
                Text("Abre apps/ios/Config/Secrets.xcconfig y deja estas dos líneas con tus datos:")
                    .font(.callout)
                Text("SUPABASE_URL = https:/$()/TU-PROYECTO.supabase.co\nSUPABASE_ANON_KEY = tu-clave-anon")
                    .font(.caption.monospaced())
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Palette.surfaceMuted, in: RoundedRectangle(cornerRadius: 8))
                Text("Ojo: la URL va con /$()/ en lugar de //. En ese archivo, // empieza un comentario y la URL queda cortada.")
                    .font(.callout)
                    .foregroundStyle(Palette.warn)

                VStack(alignment: .leading, spacing: 4) {
                    Text("Lo que la app leyó:")
                        .font(.footnote.weight(.semibold))
                    Text("URL: \(AppConfig.rawSupabaseURL.isEmpty ? "(vacía)" : AppConfig.rawSupabaseURL)")
                    Text("Clave anon: \(AppConfig.supabaseAnonKey == nil ? "(vacía)" : "presente")")
                }
                .font(.footnote.monospaced())
                .foregroundStyle(Palette.muted)

                Text("Después de guardar, en Xcode usa Product → Clean Build Folder y vuelve a pulsar ▶.")
                    .font(.callout)
            }
            .padding(24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Palette.background)
    }
}
