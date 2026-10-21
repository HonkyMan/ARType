//
//  SelfTest.h — `ARType.exe --selftest` 的内建自检（JSON / language / settings / managed protocol）。
//  `--selftest-translate` explicitly translates synthetic text via the configured ARType service.
//
#pragma once

/// 返回失败用例数（0 = 全部通过）。输出写 stdout。
int RunSelfTests(bool includeLiveTranslate);
