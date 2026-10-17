; ARType Windows 安装器（Inno Setup）。
; 由 windows/scripts/build-release.ps1 调用：
;   ISCC.exe /DAppVersion=x.y.z ARType.iss
; 按用户级安装（无需管理员/UAC），带开始菜单项、卸载器和可选开机自启。

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{C5ACAF1E-6747-49B2-A964-0AD3E847B5AB}
AppName=ARType
AppVersion={#AppVersion}
AppPublisher=ARType
AppPublisherURL=https://github.com/HonkyMan/ARType
AppSupportURL=https://github.com/HonkyMan/ARType/issues
AppUpdatesURL=https://github.com/HonkyMan/ARType/releases
DefaultDirName={autopf}\ARType
DefaultGroupName=ARType
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\build
OutputBaseFilename=ARType-Setup-{#AppVersion}
SetupIconFile=..\assets\app.ico
UninstallDisplayIcon={app}\ARType.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
RestartApplications=no
DisableProgramGroupPage=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "autostart"; Description: "Start ARType when I sign in"; GroupDescription: "Additional options:"

[Files]
Source: "..\build\ARType.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\LICENSE"; DestDir: "{app}"; DestName: "TypeTide-LICENSE.txt"; Flags: ignoreversion

[Icons]
Name: "{group}\ARType"; Filename: "{app}\ARType.exe"
Name: "{group}\Uninstall ARType"; Filename: "{uninstallexe}"

[Registry]
; 开机自启（用户勾选时写入；卸载时清掉）
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
    ValueType: string; ValueName: "ARType"; ValueData: """{app}\ARType.exe"""; \
    Flags: uninsdeletevalue; Tasks: autostart

[Run]
Filename: "{app}\ARType.exe"; Description: "Launch ARType now"; \
    Flags: nowait postinstall skipifsilent

[UninstallRun]
; 卸载前退出正在运行的实例（用户设置保留在 %APPDATA%\ARType，重装不丢配置）
Filename: "{cmd}"; Parameters: "/C taskkill /IM ARType.exe /F"; \
    Flags: runhidden skipifdoesntexist; RunOnceId: "KillARType"
