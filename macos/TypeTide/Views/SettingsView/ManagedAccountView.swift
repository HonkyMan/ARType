import SwiftUI

struct ManagedAccountView: View {
    @ObservedObject private var account=ManagedAccount.shared
    @AppStorage(AppSettings.Keys.enabled) private var enabled = true
    @State private var permission = AccessibilityPermission.isGranted
    @State private var launchAtLogin = LaunchAtLogin.isEnabled
    var body: some View {
        Form {
            Section {
                HStack(spacing:16) {
                    Image("BrandMark").resizable().aspectRatio(contentMode:.fit).frame(width:56,height:48).foregroundStyle(TypeTideTheme.accent)
                    VStack(alignment:.leading,spacing:4) {
                        Text("ARType").font(.system(size:30,weight:.bold,design:.rounded))
                        Text("Ваши мысли. На любом языке.").foregroundStyle(.secondary)
                    }
                }.padding(.vertical,12)
                Text("Переводите выделенный текст и заменяйте его прямо в приложениях. Корпоративный сервер управляет моделью и доступом.").foregroundStyle(.secondary)
            }
            Section("Рабочий аккаунт") {
                if account.signedIn {
                    LabeledContent("Google",value:account.email.isEmpty ? "Загрузка аккаунта…":account.email)
                    if account.organizations.isEmpty {
                        Text("Пока нет доступных организаций. Попросите администратора пригласить вас на этот Google email.").foregroundStyle(.secondary)
                    } else {
                        Picker("Организация",selection:$account.selected) {
                            ForEach(account.organizations) {org in Text(org.name+(org.status=="active" ? "":" · доступ приостановлен")).tag(org.id)}
                        }
                    }
                    HStack {
                        Button("Обновить доступ") {Task {await account.refresh()}}
                        Button("Открыть кабинет") {account.openCabinet()}
                        Spacer()
                        Button("Выйти",role:.destructive) {Task {await account.logout()}}
                    }
                } else {
                    Text("Войдите с Google-аккаунтом, на который вас пригласили в команду.")
                    Button(account.busy ? "Ожидаем подтверждения в браузере…":"Войти с Google") {account.login()}
                        .buttonStyle(.borderedProminent).disabled(account.busy)
                    if !account.code.isEmpty {
                        Text(account.code).font(.system(size:28,weight:.bold,design:.monospaced)).textSelection(.enabled)
                        Text("Сверьте этот код в браузере и подтвердите подключение устройства.").font(.caption).foregroundStyle(.secondary)
                        Button("Отменить вход") {account.cancelLogin()}
                    }
                }
                if !account.message.isEmpty {Text(account.message).foregroundStyle(.orange).textSelection(.enabled)}
            }
            Section("Как пользоваться") {
                LabeledContent("Показать перевод",value:AppSettings.readShortcut?.displayString ?? "Не задано")
                LabeledContent("Перевести и заменить",value:AppSettings.rewriteShortcut?.displayString ?? "Не задано")
                Text("Выделенный текст передаётся серверу ARType и AI-провайдеру. В кабинете сохраняется только статистика без текстов. Для чувствительных приложений используйте список исключений.").font(.caption).foregroundStyle(.secondary)
            }
            Section("Приложение") {
                Toggle("Включить ARType",isOn:$enabled).onChange(of:enabled) {_,_ in TriggerController.shared.applyEnabledState()}
                Toggle("Запускать при входе в систему",isOn:$launchAtLogin).onChange(of:launchAtLogin) {_,v in
                    if !LaunchAtLogin.set(v) {launchAtLogin=LaunchAtLogin.isEnabled}
                }
                HStack {
                    Label(permission ? "Универсальный доступ разрешён":"Требуется универсальный доступ",systemImage:permission ? "checkmark.shield":"exclamationmark.shield")
                    Spacer()
                    if !permission {Button("Разрешить") {AccessibilityPermission.request()}}
                }
                if !permission {AccessibilityHelpView()}
                Text("ARType · Основано на TypeTide, MIT License").font(.caption).foregroundStyle(.secondary)
            }
        }.formStyle(.grouped).scrollContentBackground(.hidden).background(Color(nsColor:.windowBackgroundColor))
            .task {
                await account.refresh()
                while !Task.isCancelled {
                    permission=AccessibilityPermission.isGranted
                    try? await Task.sleep(for:.seconds(2))
                }
            }
    }
}
