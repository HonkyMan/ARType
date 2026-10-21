#include "SelfTest.h"
#include "App.h"
#include "Json.h"
#include "ManagedProtocol.h"
#include "ManagedResponse.h"
#include "Language.h"
#include "LocalDiagnostics.h"
#include "PopupWindow.h"
#include "Settings.h"
#include "SettingsWindow.h"
#include "Translator.h"
#include "Util.h"
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>

namespace {

int g_failures = 0;

void check(bool cond, const char* name, const std::string& detail = {}) {
    if (cond) {
        printf("  ok   %s\n", name);
    } else {
        ++g_failures;
        printf("  FAIL %s%s%s\n", name, detail.empty() ? "" : " — ", detail.c_str());
    }
}

void testJson() {
    printf("[json]\n");
    bool ok = false;
    json::Value v = json::Parse(R"({"a":1,"b":"xé\n","c":[true,null,2.5],"d":{"e":"中文"}})", &ok);
    check(ok, "parse");
    check(v["a"].asInt() == 1, "int");
    check(v["b"].asString() == "x\xC3\xA9\n", "escaped string");
    check(v["c"].size() == 3 && v["c"].at(0).asBool(), "array");
    check(v["d"]["e"].asString() == "中文", "nested utf8");

    std::string dumped = v.dump();
    bool ok2 = false;
    json::Value round = json::Parse(dumped, &ok2);
    check(ok2 && round["d"]["e"].asString() == "中文", "roundtrip");

    json::Parse("{bad json", &ok);
    check(!ok, "reject malformed");

    // SSE delta 场景
    json::Value sse = json::Parse(R"({"choices":[{"delta":{"content":"你好"}}]})", &ok);
    check(ok && sse["choices"].at(0)["delta"]["content"].asString() == "你好", "sse delta shape");
}

void testJsonFuzz() {
    printf("[json fuzz]\n");
    // 解析器面对的是不受信任的服务器响应——喂随机变异输入，只要不崩不死循环就算过。
    // 确定性 xorshift，失败可复现。
    uint64_t rng = 0x5EED5EED5EEDULL;
    auto next = [&rng]() {
        rng ^= rng << 13;
        rng ^= rng >> 7;
        rng ^= rng << 17;
        return rng;
    };
    const char* seeds[] = {
        R"({"choices":[{"delta":{"content":"hello 世界"}}]})",
        R"({"response":"ok","done":false,"n":-1.5e10})",
        R"([1,[2,[3,[4,[5,null,true,false,"你😀"]]]]])",
        R"({"a":"\\\"\n\t\u0000","b":{},"c":[]})",
    };
    for (int iter = 0; iter < 20000; ++iter) {
        std::string s = seeds[next() % std::size(seeds)];
        int mutations = 1 + (int)(next() % 6);
        for (int m = 0; m < mutations; ++m) {
            if (s.empty()) break;
            size_t pos = next() % s.size();
            switch (next() % 4) {
            case 0: s[pos] = (char)(next() & 0xFF); break;          // 改一字节
            case 1: s.erase(pos, 1 + next() % 5); break;            // 删一段
            case 2: s.insert(pos, 1, (char)(next() & 0xFF)); break; // 插一字节
            case 3: s.resize(pos); break;                           // 截断
            }
        }
        bool ok = false;
        json::Value v = json::Parse(s, &ok);  // 只要求不崩溃、正常返回
        (void)v;
    }
    check(true, "20000 mutated inputs parsed without crash");
}

void testDetect() {
    printf("[language detect]\n");
    auto is = [](std::optional<Language> got, Language want) { return got && *got == want; };
    check(is(lang::Detect(L"今天天气怎么样？我想出去散步。"), Language::Chinese), "zh");
    check(is(lang::Detect(L"The quick brown fox jumps over the lazy dog and it was great."), Language::English), "en");
    check(is(lang::Detect(L"Это очень интересная книга о русской истории."), Language::Russian), "ru");
    check(is(lang::Detect(L"مرحبا كيف حالك اليوم؟"), Language::Arabic), "ar");
    check(is(lang::Detect(L"El perro corre por el parque y los niños juegan con una pelota."), Language::Spanish), "es");
    check(is(lang::Detect(L"Le chat est sur la table et il ne veut pas descendre du tout."), Language::French), "fr");
    check(is(lang::Detect(L"आप कैसे हैं? मुझे हिंदी बहुत पसंद है।"), Language::Hindi), "hi");
    check(!lang::Detect(L"12345 !!! ???").has_value(), "digits → unknown");
    check(!lang::Detect(L"").has_value(), "empty → unknown");
}

void testSettings() {
    printf("[settings]\n");
    // 隔离到子目录，避免覆盖外层准备好的 settings.json（live translate 用）
    std::wstring outer = util::AppDataDir();
    SetEnvironmentVariableW(L"TYPETIDE_DATA_DIR", (outer + L"\\selftest-settings").c_str());

    Settings s;
    s.enabled = false;
    s.tenantId = "test-organization";
    s.nativeLanguage = Language::French;
    s.foreignLanguage = Language::Russian;
    s.readDirection = TranslationDirection::ForeignToNative;
    s.readShortcut = {MOD_CONTROL | MOD_SHIFT, 'T'};
    s.rewriteShortcut = {0, 0};
    s.readShortcutAction = ShortcutAction::ForeignPopup;
    s.rewriteShortcutAction = ShortcutAction::NativeReplace;
    s.selectionTrigger = SelectionTrigger::Icon;
    s.rewritePreview = true;
    s.rewriteStyle = RewriteStyle::Polished;
    s.skipApps = {L"notepad", L"code.exe"};
    check(s.save(), "atomic save");

    Settings loaded;
    loaded.load();
    check(loaded.enabled == false, "enabled");
    check(loaded.tenantId == "test-organization", "organization persists");
    check(loaded.nativeLanguage == Language::French && loaded.foreignLanguage == Language::Russian, "languages");
    check(loaded.readDirection == TranslationDirection::ForeignToNative, "direction");
    check(loaded.readShortcut == Hotkey{MOD_CONTROL | MOD_SHIFT, 'T'}, "hotkey");
    check(loaded.rewriteShortcut == Hotkey{0, 0} && !loaded.rewriteShortcut.isConfigured(),
          "cleared hotkey persists");
    check(loaded.rewriteShortcut.displayString() == L"Not set", "cleared hotkey display");
    check(loaded.readShortcutAction == ShortcutAction::ForeignPopup &&
          loaded.rewriteShortcutAction == ShortcutAction::NativeReplace, "shortcut actions");
    check(loaded.selectionTrigger == SelectionTrigger::Icon, "trigger");
    check(loaded.rewritePreview && loaded.rewriteStyle == RewriteStyle::Polished, "behavior");
    check(loaded.skipApps.size() == 2 && loaded.skipApps[1] == L"code.exe", "skip apps");

    check(Hotkey{MOD_ALT, 'D'}.displayString() == L"Alt+D", "hotkey display",
          util::Narrow(Hotkey{MOD_ALT, 'D'}.displayString()));

    // 不可信/损坏配置必须回落到安全范围，不能把异常值带进 WinHTTP/RegisterHotKey。
    {
        std::ofstream bad(Settings::filePath(), std::ios::binary | std::ios::trunc);
        bad << R"({"backend":"builtin","openAIBaseURL":"https://legacy.invalid","openAIKey":"legacy-test-key",)"
               R"("ollamaModel":"legacy-model","tenantId":"test-organization","nativeLanguage":"fr",)"
               R"("readShortcut":{"modifiers":4294967295,"vk":999},)"
               R"("skipApps":["Code.exe","code.exe","","ok.exe"]})";
    }
    Settings sanitized;
    sanitized.load();
    check(sanitized.readShortcut == Hotkey{MOD_ALT, 'D'}, "invalid hotkey sanitized");
    check(sanitized.skipApps.size() == 2, "skip apps sanitized and deduplicated");
    check(sanitized.tenantId == "test-organization" && sanitized.nativeLanguage == Language::French,
          "legacy configuration preserves corporate preferences");
    check(sanitized.save(), "migrated configuration saved");
    std::ifstream migratedFile(Settings::filePath(), std::ios::binary);
    std::stringstream migratedBuffer;
    migratedBuffer << migratedFile.rdbuf();
    auto migrated = json::Parse(migratedBuffer.str());
    check(migrated.isObject() && migrated["backend"].isNull() && migrated["openAIKey"].isNull() &&
          migrated["openAIBaseURL"].isNull() && migrated["ollamaModel"].isNull(),
          "legacy provider configuration and plaintext credentials are never persisted");

    SetEnvironmentVariableW(L"TYPETIDE_DATA_DIR", outer.c_str());
}

void testLocalDiagnosticsPrivacy() {
    printf("[local diagnostics]\n");
    diagnostics::Clear();
    diagnostics::Record("translation", "failure", "artype", "uia", "network", 120, 450, 42);
    std::ifstream file(diagnostics::Path(), std::ios::binary);
    std::stringstream buffer;
    buffer << file.rdbuf();
    const std::string report = buffer.str();
    check(!report.empty(), "diagnostic report written");
    check(report.find("selectedText") == std::string::npos &&
          report.find("translationText") == std::string::npos &&
          report.find("clipboard") == std::string::npos &&
          report.find("apiKey") == std::string::npos,
          "diagnostic schema excludes sensitive fields");
}

void testManagedProtocol() {
    const auto policy=json::Parse(R"({"languages":["ru","en","bn","hi","zh","es","fr","ar","pt","id"]})");
    check(managed::AllowedLanguages(policy).size()==10,"all configured languages are available");
    check(managed::LanguagePermitted(policy,Language::Bengali),"enabled Bengali is allowed");
    const auto restricted=json::Parse(R"({"languages":["ru","en","unknown"]})");
    check(managed::AllowedLanguages(restricted).size()==2,"unknown codes do not create languages");
    check(!managed::LanguagePermitted(restricted,Language::Bengali),"disabled selection must not translate");
    check(managed::IsLanguageSettingsLink("artype://settings/languages"),"language deep link recognized");
    check(!managed::IsLanguageSettingsLink("artype://settings/languages?command=bad"),"deep link rejects extra commands");

    printf("[managed protocol]\n");
    check(managed::OriginAllowed("https://translate.example.com") &&
          !managed::OriginAllowed("http://example.com") &&
          !managed::OriginAllowed("https://user:secret@example.com"), "managed origin policy");
    const auto request = managed::Request("Hello", "en", "ru", "formal", "tenant", "request");
    check(request["tenant_id"].asString() == "tenant" && request["style"].asString() == "formal" &&
          request["model"].isNull() && request["messages"].isNull(), "server owns provider and prompt");
    const std::string delta = R"(data: {"choices":[{"delta":{"content":"Hello"}}]})";
    check(managed::Translation(delta + "\r\n\r\ndata: [DONE]\r\n") == "Hello",
          "complete managed response");
    for (const auto& invalid : {delta, delta + "\ndata: {invalid}\ndata: [DONE]\n"}) {
        bool rejected = false;
        try { managed::Translation(invalid); } catch (const std::runtime_error&) { rejected = true; }
        check(rejected, "incomplete or malformed response cannot be used for replacement");
    }
}

void testSharedContracts() {
    printf("[shared contracts]\n");
    std::ifstream file(TYPETIDE_CONTRACTS_PATH, std::ios::binary);
    if (!file) {
        check(false, "open translation-contracts.json", TYPETIDE_CONTRACTS_PATH);
        return;
    }
    std::stringstream buffer;
    buffer << file.rdbuf();
    bool ok = false;
    json::Value root = json::Parse(buffer.str(), &ok);
    check(ok && root.isObject(), "parse translation-contracts.json");
    if (!ok) return;

    if (const json::Array* cases = root["languageDetection"].array()) {
        for (const auto& item : *cases) {
            std::string expected = item["expected"].asString();
            auto detected = lang::Detect(util::Widen(item["text"].asString()));
            check(detected && std::string(lang::Code(*detected)) == expected,
                  ("detect " + expected).c_str());
        }
    }

    if (const json::Array* cases = root["directionCases"].array()) {
        for (const auto& item : *cases) {
            auto mode = lang::DirectionFromCode(item["mode"].asString());
            auto native = lang::FromCode(item["native"].asString());
            auto foreign = lang::FromCode(item["foreign"].asString());
            auto target = lang::FromCode(item["target"].asString());
            check(mode && native && foreign && target, "direction contract codes");
            if (!mode || !native || !foreign || !target) continue;
            auto route = lang::ResolveDirection(util::Widen(item["text"].asString()), *mode,
                                                item["isWrite"].asBool(), *native, *foreign);
            const bool sourceMatches = item["source"].isNull()
                ? !route.source.has_value()
                : route.source && std::string(lang::Code(*route.source)) == item["source"].asString();
            check(sourceMatches && route.target == *target,
                  ("direction " + item["mode"].asString()).c_str());
        }
    }

}

void testReplaceClick() {
    printf("[Replace click]\n");
    auto& popup = PopupWindow::shared();
    int replacements = 0;
    popup.show(L"source", Language::English, RECT{100, 100, 200, 120}, true);
    popup.appendDelta(L"translation");
    popup.finishTranslation();
    popup.onReplace = [&] { ++replacements; };
    HWND hwnd = FindWindowW(L"ARTypePopup", nullptr);
    check(hwnd != nullptr, "popup created");
    if (hwnd) {
        RECT rc{};
        GetClientRect(hwnd, &rc);
        const int dpi = (int)GetDpiForWindow(hwnd);
        const LPARAM button = MAKELPARAM(rc.right - MulDiv(50, dpi, 96),
                                        rc.bottom - MulDiv(28, dpi, 96));
        SendMessageW(hwnd, WM_LBUTTONDOWN, MK_LBUTTON, button);
        check(replacements == 0 && popup.isVisible(), "mouse-down does not replace or close");
        SendMessageW(hwnd, WM_LBUTTONUP, 0, 0);
        check(replacements == 0, "release outside cancels");
        SendMessageW(hwnd, WM_LBUTTONDOWN, MK_LBUTTON, button);
        SendMessageW(hwnd, WM_CANCELMODE, 0, 0);
        SendMessageW(hwnd, WM_LBUTTONUP, 0, button);
        check(replacements == 0, "cancelled click does not replace");
        SendMessageW(hwnd, WM_LBUTTONDOWN, MK_LBUTTON, button);
        SendMessageW(hwnd, WM_LBUTTONUP, 0, button);
        check(replacements == 1, "complete click replaces once");
        SendMessageW(hwnd, WM_LBUTTONUP, 0, button);
        check(replacements == 1, "unmatched mouse-up does not replace");
    }
    popup.onReplace = nullptr;
    popup.close();
}

void testProfileRefreshInvalidatesOldTenantTranslation() {
    printf("[account profile context]\n");
    auto& settings=Settings::shared();
    const Settings saved=settings;
    auto& popup=PopupWindow::shared();
    settings.tenantId="old-tenant";
    popup.show(L"Selection",Language::English,RECT{100,100,300,130},true);
    popup.appendDelta(L"OLD_TENANT_RESULT");
    const auto newProfile=json::Parse(R"({"user":{"email":"member@example.com"},"tenants":[{"id":"new-tenant","name":"New team"}]})");
    SettingsWindow::applyAccountProfile(newProfile);
    check(settings.tenantId=="new-tenant","profile refresh selects an available organization");
    check(!popup.isVisible(),"profile-triggered organization change closes old translation");
    popup.close();
    settings.tenantId="old-tenant";
    popup.show(L"Selection",Language::English,RECT{100,100,300,130},true);
    SettingsWindow::applyAccountProfile(json::Parse(R"({"user":{"email":"member@example.com"},"tenants":[]})"));
    check(settings.tenantId.empty(),"no available organizations clears selection");
    check(!popup.isVisible(),"revoked organization closes old translation");
    popup.close();
    settings.tenantId="new-tenant";
    popup.show(L"Selection",Language::English,RECT{100,100,300,130},true);
    SettingsWindow::applyAccountProfile(newProfile);
    check(popup.isVisible(),"unchanged organization keeps current translation open");
    popup.close();settings=saved;settings.save();
}

void testShortcutStatus() {
    printf("[shortcut status]\n");
    auto& settings = Settings::shared();
    const Settings saved = settings;
    settings.selectionTrigger = SelectionTrigger::None;
    settings.enabled = true;
    settings.readShortcut = {MOD_ALT, 'D'};
    settings.rewriteShortcut = settings.readShortcut;
    auto& app = App::shared();
    app.applyEnabledState();
    check(!app.shortcutsRegistered() && !app.shortcutIssue().empty(),
          "duplicate shortcuts report an inline issue without a dialog");
    settings.enabled = false;
    app.applyEnabledState();
    check(!app.shortcutsRegistered() && app.shortcutIssue().empty(),
          "disabling clears shortcut issues");
    settings.enabled = true;
    settings.readShortcut = {0, 0};
    settings.rewriteShortcut = {0, 0};
    app.applyEnabledState();
    check(!app.shortcutsRegistered() && app.shortcutIssue().empty(),
          "cleared shortcuts are unconfigured rather than conflicting");
    settings = saved;
}

void testLiveTranslate() {
    printf("[live managed translation] (configured service and OS credential session)\n");
    Settings::shared().load();
    std::wstring err;
    auto result = translator::TranslateFully(
        {L"你好，世界", std::optional<Language>(Language::Chinese), Language::English, RewriteStyle::Faithful}, &err);
    check(result.has_value(), "translate", util::Narrow(err));
    if (result) {
        printf("  result: %s\n", util::Narrow(*result).c_str());
    }
}

} // namespace

int RunSelfTests(bool includeLiveTranslate) {
    printf("ARType self-test (v%s)\n", TYPETIDE_VERSION_STRING);
    testJson();
    testJsonFuzz();
    testDetect();
    testSettings();
    testLocalDiagnosticsPrivacy();
    testManagedProtocol();
    testSharedContracts();
    testReplaceClick();
    testShortcutStatus();
    testProfileRefreshInvalidatesOldTenantTranslation();
    check(SettingsWindow::testNavigationIconColors(true), "dark navigation icons preserve light strokes");
    check(SettingsWindow::testNavigationIconColors(false), "light navigation icons preserve dark strokes");
    if (includeLiveTranslate) {
        testLiveTranslate();
    }
    printf(g_failures ? "\n%d FAILURE(S)\n" : "\nall tests passed\n", g_failures);
    return g_failures;
}
