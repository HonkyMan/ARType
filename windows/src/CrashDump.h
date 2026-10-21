//
//  CrashDump.h — local numeric crash metadata in %APPDATA%\ARType\crashes\.
//  No process memory, addresses, exception parameters, or automatic upload.
//
#pragma once

namespace crashdump {

/// 安装未处理异常过滤器（进程启动时调一次）
void Install();

} // namespace crashdump
