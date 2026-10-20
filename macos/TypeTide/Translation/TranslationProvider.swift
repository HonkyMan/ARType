//
//  TranslationProvider.swift
//  TypeTide
//
//  翻译后端抽象：所有 provider 输出流式增量文本。
//

import Foundation

enum TranslationError: LocalizedError {
    case notConfigured(String)
    case network(String)
    case empty

    var errorDescription: String? {
        switch self {
        case .notConfigured(let m): return m
        case .network(let m): return m
        case .empty: return "Empty translation"
        }
    }

    var category: String {
        switch self {
        case .notConfigured: return "configuration"
        case .empty: return "emptyResponse"
        case .network(let message):
            let lower = message.lowercased()
            if lower.contains("timed out") || lower.contains("timeout") { return "timeout" }
            if lower.contains("http 401") || lower.contains("http 403") || lower.contains("unauthorized") {
                return "authentication"
            }
            if lower.contains("could not connect") || lower.contains("cannot connect") ||
                lower.contains("network connection") || lower.contains("not connected") {
                return "connectivity"
            }
            return "provider"
        }
    }
}

/// 一次翻译请求
struct TranslationRequest {
    let text: String
    /// 源语言；nil 表示让模型自动判断
    let source: Language?
    let target: Language
    /// 风格（仅改写用；读翻译为 faithful）
    var style: RewriteStyle = .faithful
}

protocol TranslationProvider {
    var id: String { get }
    /// 返回译文增量（流式）。调用方负责拼接。
    func stream(_ request: TranslationRequest) -> AsyncThrowingStream<String, Error>
}
