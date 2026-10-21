import AppKit
import Combine
import CryptoKit
import Foundation

enum ManagedProtocol {
    static func origin(_ value: String) -> URL? {
        ManagedEndpoint.canonicalOrigin(value).flatMap(URL.init(string:))
    }
    static func body(_ request: TranslationRequest, tenant: String) throws -> Data {
        var b: [String: Any] = ["text":request.text,"target":request.target.rawValue,
            "style":request.style.rawValue,"tenant_id":tenant,"request_id":UUID().uuidString.lowercased()]
        if let source=request.source { b["source"]=source.rawValue }
        return try JSONSerialization.data(withJSONObject:b)
    }
    static func translation(_ data: Data) throws -> String {
        do {
            return try ManagedResponse.translation(data)
        } catch let error as ManagedResponseError {
            if case .empty = error { throw TranslationError.empty }
            throw TranslationError.network(error.localizedDescription)
        }
    }
}

enum ManagedAPI {
    static var base: URL? {
        ManagedEndpoint.configuredOrigin.flatMap(URL.init(string:))
    }
    static func request(_ path: String, method: String="GET", body: Data?=nil, token: String="") async throws -> (Data,Int) {
        guard let base else { throw TranslationError.notConfigured("Адрес сервиса ARType не настроен. Получите установщик у администратора.") }
        var r=URLRequest(url:base.appendingPathComponent(path)); r.httpMethod=method;r.httpBody=body;r.timeoutInterval=60
        r.setValue("application/json",forHTTPHeaderField:"Content-Type")
        if !token.isEmpty { r.setValue("Bearer \(token)",forHTTPHeaderField:"Authorization") }
        let (data,response)=try await ManagedTransport.data(for:r)
        let status=(response as? HTTPURLResponse)?.statusCode ?? 500
        guard (200...299).contains(status) else {
            let b=try? JSONSerialization.jsonObject(with:data) as? [String:Any]
            let e=b?["error"] as? [String:Any]
            if e?["code"] as? String == "language_not_allowed" { throw TranslationError.languageUnavailable }
            throw TranslationError.network(e?["message"] as? String ?? "Сервис ARType недоступен (\(status)).")
        }
        return (data,status)
    }
    static func json(_ path: String, body: [String:Any]?=nil, token: String="") async throws -> (Data,Int) {
        try await request(path,method:body == nil ? "GET":"POST",body:try body.map {try JSONSerialization.data(withJSONObject:$0)},token:token)
    }
}

struct ManagedLanguagePolicy: Decodable {
    let tenant_id: String
    var languages: [String]
    var available: [Language] { languages.compactMap(Language.init(rawValue:)) }
    func permits(_ selected: [Language]) -> Bool { selected.allSatisfy { available.contains($0) } }
}

struct ManagedOrganization: Decodable, Identifiable {
    let id: String
    let name: String
    let status: String
    var languages: [String]
    let can_translate: Bool?
    let access_message: String?
    var blockedMessage: String? {
        guard can_translate == false else { return nil }
        return access_message ?? "Доступ к программе отключён. Обратитесь к владельцу организации."
    }
}

@MainActor
final class ManagedAccount: ObservableObject {
    static let shared=ManagedAccount()
    @Published var email=""
    @Published var organizations:[ManagedOrganization]=[]
    @Published var message=""
    @Published var code=""
    @Published var busy=false
    @Published var accessNotice=""
    @Published var showAccessNotice=false
    @Published var selected: String=UserDefaults.standard.string(forKey:"artype.organization") ?? "" {
        didSet {
            translationContextID = UUID()
            TriggerController.shared.cancelTranslations()
            UserDefaults.standard.set(selected,forKey:"artype.organization")
            updateAccessNotice()
        }
    }
    private var loginTask: Task<Void,Never>?
    private var syncTask: Task<Void,Never>?
    private var refreshing = false
    private(set) var translationContextID = UUID()
    fileprivate var generation=UUID()
    var token: String { Credentials.sessionToken() }
    var signedIn: Bool { !token.isEmpty }
    var allowedLanguages:[Language] {
        organizations.first(where:{$0.id==selected})?.languages.compactMap(Language.init(rawValue:)) ?? []
    }
    private init() {}
    private func updateAccessNotice() {
        let notice=organizations.first(where:{$0.id==selected})?.blockedMessage ?? ""
        if notice != accessNotice {accessNotice=notice;showAccessNotice = !notice.isEmpty}
    }
    func startAutomaticRefresh() {
        guard syncTask == nil else { return }
        syncTask = Task { @MainActor in
            while !Task.isCancelled {
                await refresh()
                do { try await Task.sleep(for:.seconds(30)) } catch { return }
            }
        }
    }
    func applyLanguagePolicy(_ policy: ManagedLanguagePolicy) {
        guard policy.tenant_id == selected,
              let index = organizations.firstIndex(where: {$0.id == policy.tenant_id}) else { return }
        organizations[index].languages = policy.languages
        // Preserve the user's pair: an unavailable choice requires an explicit correction.
    }
    func refresh() async {
        guard signedIn, !refreshing else { return }
        refreshing=true
        defer { refreshing=false }
        let current=generation
        do {
            struct Profile:Decodable {struct User:Decodable{let email:String};let user:User;let tenants:[ManagedOrganization]}
            let (data,_)=try await ManagedAPI.json("api/me",token:token)
            let p=try JSONDecoder().decode(Profile.self,from:data)
            guard generation==current else {return}
            email=p.user.email;organizations=p.tenants;message=""
            UserDefaults.standard.set(true,forKey:AppSettings.Keys.hasCompletedFirstLaunch)
            if !organizations.contains(where:{$0.id==selected}) {selected=organizations.first?.id ?? ""}
            updateAccessNotice()
        }catch { if generation==current {message=error.localizedDescription} }
    }
    func login() {
        translationContextID = UUID()
        loginTask?.cancel();generation=UUID();let current=generation
        busy=true;message="";code=""
        loginTask=Task {
            defer {if generation==current {busy=false;code=""}}
            do {
                var bytes=[UInt8](repeating:0,count:32)
                guard SecRandomCopyBytes(kSecRandomDefault,bytes.count,&bytes)==errSecSuccess else {throw TranslationError.notConfigured("Не удалось создать безопасную сессию входа.")}
                let verifier=bytes.map {String(format:"%02x",$0)}.joined()
                let challenge=SHA256.hash(data:Data(verifier.utf8)).map {String(format:"%02x",$0)}.joined()
                struct Start:Decodable {let id:String;let poll_token:String;let code:String;let login_url:String}
                let (data,_)=try await ManagedAPI.json("api/device/start",body:["challenge":challenge])
                let start=try JSONDecoder().decode(Start.self,from:data)
                guard generation==current, !Task.isCancelled else {return}
                guard let url=URL(string:start.login_url), let expected=ManagedEndpoint.configuredOrigin,
                      ManagedEndpoint.loginURLAllowed(url,origin:expected) else {throw TranslationError.network("Сервис вернул неверный адрес входа.")}
                code=start.code
                guard NSWorkspace.shared.open(url) else {throw TranslationError.network("Не удалось открыть системный браузер.")}
                for _ in 0..<100 {
                    try await Task.sleep(for:.seconds(3));try Task.checkCancellation()
                    let (result,status)=try await ManagedAPI.json("api/device/poll",body:["id":start.id,"poll_token":start.poll_token,"verifier":verifier])
                    guard generation==current else {return}
                    if status==200 {
                        struct Grant:Decodable{let token:String};let grant=try JSONDecoder().decode(Grant.self,from:result)
                        guard Credentials.saveSessionToken(grant.token) else {throw TranslationError.notConfigured("Не удалось сохранить сессию в Связке ключей.")}
                        translationContextID = UUID()
                        await refresh();return
                    }
                }
                throw TranslationError.network("Время входа истекло. Повторите вход.")
            }catch is CancellationError {}catch {if generation==current{message=error.localizedDescription}}
        }
    }
    func cancelLogin() {translationContextID=UUID();generation=UUID();loginTask?.cancel();loginTask=nil;busy=false;code=""}
    func logout() async {
        TriggerController.shared.cancelTranslations()
        cancelLogin();let old=token
        // Clearing local credentials is mandatory even when the server cannot be reached.
        guard Credentials.saveSessionToken("") else {message="Не удалось удалить сессию из Связки ключей.";return}
        generation=UUID();email="";organizations=[];selected="";message="";accessNotice="";showAccessNotice=false
        if !old.isEmpty {
            do {_=try await ManagedAPI.json("api/logout",body:[:],token:old)}
            catch {message="Вы вышли на этом устройстве. Сервер не подтвердил отзыв сессии: \(error.localizedDescription)"}
        }
    }
    func openCabinet(){if let base=ManagedAPI.base {NSWorkspace.shared.open(base)}}
}

struct ManagedTranslationProvider: TranslationProvider {
    let id="artype"
    let token:String
    let tenant:String
    let generation:UUID
    let selectedLanguages:[Language]
    @MainActor init(){token=ManagedAccount.shared.token;tenant=ManagedAccount.shared.selected;generation=ManagedAccount.shared.generation;selectedLanguages=[LanguageConfig.sourceLanguage,LanguageConfig.targetLanguage]}
    func stream(_ request: TranslationRequest) -> AsyncThrowingStream<String,Error> {
        AsyncThrowingStream { continuation in
            let task=Task {
                do {
                    guard !token.isEmpty,!tenant.isEmpty else {throw TranslationError.notConfigured("Войдите в ARType и выберите организацию в настройках.")}
                    let (policyData,_) = try await ManagedAPI.json("api/tenants/\(tenant)/language-policy",token:token)
                    let policy = try JSONDecoder().decode(ManagedLanguagePolicy.self,from:policyData)
                    guard policy.tenant_id == tenant else {throw TranslationError.network("Неверная политика языков сервера.")}
                    guard ManagedAccount.shared.generation==generation, ManagedAccount.shared.selected==tenant else {throw CancellationError()}
                    ManagedAccount.shared.applyLanguagePolicy(policy)
                    guard policy.permits(selectedLanguages + [request.target] + (request.source.map {[$0]} ?? [])) else {throw TranslationError.languageUnavailable}
                    let body=try ManagedProtocol.body(request,tenant:tenant)
                    let (data,_)=try await ManagedAPI.request("api/translate",method:"POST",body:body,token:token)
                    try Task.checkCancellation()
                    guard ManagedAccount.shared.generation==generation, ManagedAccount.shared.selected==tenant else {throw CancellationError()}
                    continuation.yield(try ManagedProtocol.translation(data));continuation.finish()
                }catch {continuation.finish(throwing:error)}
            }
            continuation.onTermination={_ in task.cancel()}
        }
    }
}
