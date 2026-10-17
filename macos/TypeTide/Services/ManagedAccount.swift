import AppKit
import Combine
import CryptoKit
import Foundation

enum ManagedProtocol {
    static func origin(_ value: String) -> URL? {
        guard let u=URLComponents(string: value), let host=u.host,
              u.user == nil, u.password == nil, u.query == nil, u.fragment == nil,
              u.path.isEmpty || u.path == "/",
              u.scheme == "https" || (u.scheme == "http" && ["localhost", "127.0.0.1", "[::1]", "::1"].contains(host)) else { return nil }
        return u.url
    }
    static func body(_ request: TranslationRequest, tenant: String) throws -> Data {
        var b: [String: Any] = ["text":request.text,"target":request.target.rawValue,
            "style":request.style.rawValue,"tenant_id":tenant,"request_id":UUID().uuidString.lowercased()]
        if let source=request.source { b["source"]=source.rawValue }
        return try JSONSerialization.data(withJSONObject:b)
    }
    static func translation(_ data: Data) throws -> String {
        let lines=String(decoding:data,as:UTF8.self).components(separatedBy:.newlines)
        guard lines.contains(where:{$0.trimmingCharacters(in:.whitespaces)=="data: [DONE]"}) else {
            throw TranslationError.network("Перевод прерван. Исходный текст сохранён.")
        }
        let result=lines.compactMap { OpenAISSEDecoder.content(from:$0) }.joined()
        guard !result.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty else { throw TranslationError.empty }
        return result
    }
}

private final class ManagedNoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

enum ManagedAPI {
    static var base: URL? {
        guard let path=Bundle.main.url(forResource:"managed-config",withExtension:"json"),
              let data=try? Data(contentsOf:path),
              let b=try? JSONSerialization.jsonObject(with:data) as? [String:String],
              let value=b["service_url"] else { return nil }
        return ManagedProtocol.origin(value)
    }
    static let session=URLSession(configuration:.ephemeral,delegate:ManagedNoRedirect(),delegateQueue:nil)
    static func request(_ path: String, method: String="GET", body: Data?=nil, token: String="") async throws -> (Data,Int) {
        guard let base else { throw TranslationError.notConfigured("Адрес сервиса ARType не настроен. Получите установщик у администратора.") }
        var r=URLRequest(url:base.appendingPathComponent(path)); r.httpMethod=method;r.httpBody=body;r.timeoutInterval=60
        r.setValue("application/json",forHTTPHeaderField:"Content-Type")
        if !token.isEmpty { r.setValue("Bearer \(token)",forHTTPHeaderField:"Authorization") }
        let (data,response)=try await session.data(for:r)
        let status=(response as? HTTPURLResponse)?.statusCode ?? 500
        guard (200...299).contains(status) else {
            let b=try? JSONSerialization.jsonObject(with:data) as? [String:Any]
            let e=b?["error"] as? [String:String]
            throw TranslationError.network(e?["message"] ?? "Сервис ARType недоступен (\(status)).")
        }
        return (data,status)
    }
    static func json(_ path: String, body: [String:Any]?=nil, token: String="") async throws -> (Data,Int) {
        try await request(path,method:body == nil ? "GET":"POST",body:try body.map {try JSONSerialization.data(withJSONObject:$0)},token:token)
    }
}

struct ManagedOrganization: Decodable, Identifiable {
    let id: String
    let name: String
    let status: String
    let languages: [String]
}

@MainActor
final class ManagedAccount: ObservableObject {
    static let shared=ManagedAccount()
    @Published var email=""
    @Published var organizations:[ManagedOrganization]=[]
    @Published var message=""
    @Published var code=""
    @Published var busy=false
    @Published var selected: String=UserDefaults.standard.string(forKey:"artype.organization") ?? "" {
        didSet {
            UserDefaults.standard.set(selected,forKey:"artype.organization")
            alignLanguages()
        }
    }
    private var loginTask: Task<Void,Never>?
    private var generation=UUID()
    var token: String { Credentials.cloudAPIKey() }
    var signedIn: Bool { !token.isEmpty }
    var allowedLanguages:[Language] {
        organizations.first(where:{$0.id==selected})?.languages.compactMap(Language.init(rawValue:)) ?? [.russian,.english]
    }
    private init() {}
    private func alignLanguages() {
        guard !allowedLanguages.isEmpty else { return }
        if !allowedLanguages.contains(LanguageConfig.sourceLanguage) {LanguageConfig.sourceLanguage=allowedLanguages[0]}
        if !allowedLanguages.contains(LanguageConfig.targetLanguage) {LanguageConfig.targetLanguage=allowedLanguages.last!}
    }
    func refresh() async {
        guard signedIn else { return }
        let current=generation
        do {
            struct Profile:Decodable {struct User:Decodable{let email:String};let user:User;let tenants:[ManagedOrganization]}
            let (data,_)=try await ManagedAPI.json("api/me",token:token)
            let p=try JSONDecoder().decode(Profile.self,from:data)
            guard generation==current else {return}
            email=p.user.email;organizations=p.tenants;message=""
            if !organizations.contains(where:{$0.id==selected}) {selected=organizations.first?.id ?? ""}
            alignLanguages()
        }catch { if generation==current {message=error.localizedDescription} }
    }
    func login() {
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
                guard let url=URL(string:start.login_url), let base=ManagedAPI.base,
                      url.scheme==base.scheme,url.host==base.host,url.port==base.port else {throw TranslationError.network("Сервис вернул неверный адрес входа.")}
                code=start.code
                guard NSWorkspace.shared.open(url) else {throw TranslationError.network("Не удалось открыть системный браузер.")}
                for _ in 0..<100 {
                    try await Task.sleep(for:.seconds(3));try Task.checkCancellation()
                    let (result,status)=try await ManagedAPI.json("api/device/poll",body:["id":start.id,"poll_token":start.poll_token,"verifier":verifier])
                    guard generation==current else {return}
                    if status==200 {
                        struct Grant:Decodable{let token:String};let grant=try JSONDecoder().decode(Grant.self,from:result)
                        guard Credentials.saveCloudAPIKey(grant.token) else {throw TranslationError.notConfigured("Не удалось сохранить сессию в Связке ключей.")}
                        await refresh();return
                    }
                }
                throw TranslationError.network("Время входа истекло. Повторите вход.")
            }catch is CancellationError {}catch {if generation==current{message=error.localizedDescription}}
        }
    }
    func cancelLogin() {generation=UUID();loginTask?.cancel();loginTask=nil;busy=false;code=""}
    func logout() async {
        cancelLogin();let old=token
        // Clearing local credentials is mandatory even when the server cannot be reached.
        guard Credentials.saveCloudAPIKey("") else {message="Не удалось удалить сессию из Связки ключей.";return}
        generation=UUID();email="";organizations=[];selected="";message=""
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
    @MainActor init(){token=ManagedAccount.shared.token;tenant=ManagedAccount.shared.selected}
    func stream(_ request: TranslationRequest) -> AsyncThrowingStream<String,Error> {
        AsyncThrowingStream { continuation in
            let task=Task {
                do {
                    guard !token.isEmpty,!tenant.isEmpty else {throw TranslationError.notConfigured("Войдите в ARType и выберите организацию в настройках.")}
                    let body=try ManagedProtocol.body(request,tenant:tenant)
                    let (data,_)=try await ManagedAPI.request("api/translate",method:"POST",body:body,token:token)
                    try Task.checkCancellation()
                    continuation.yield(try ManagedProtocol.translation(data));continuation.finish()
                }catch {continuation.finish(throwing:error)}
            }
            continuation.onTermination={_ in task.cancel()}
        }
    }
}
