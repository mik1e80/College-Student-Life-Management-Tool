# 双衡 Android 离线版

1.4.0 新增应用私有原子账本文件。确认保存前会同步写盘，避免 WebView localStorage 尚未落盘时立即结束进程导致最后几笔丢失。原 localStorage 继续作为镜像，旧版账本可按 revision 迁移并保留；不新增联网或广泛存储权限。

安卓版本将账本页面、图标和程序一起放进 APK。安装完成后，首次启动也不需要访问原网站、ChatGPT、GitHub 或 Google 服务。APK 不申请联网权限；账本保存在应用自己的 WebView 存储内。

## 版本与支持范围

| 项目 | 当前设定 |
| --- | --- |
| 应用名 | 双衡 |
| applicationId | `cn.yiriyoushu.campuslife` |
| versionName / versionCode | `1.5.0` / `8` |
| 系统下限 | Android 8.0 / API 26 |
| 编译 / 目标 SDK | API 35 |
| Android Gradle Plugin | `8.7.3` |
| Gradle / JDK | `8.9` / `17` |
| AndroidX WebKit | `1.12.1` |

系统版本达标之外，还需要可正常工作的现代 Android System WebView，支持 ES 模块、`crypto.randomUUID`、`structuredClone` 和 HTML `dialog`。应用不包含独立浏览器内核。老旧或被禁用的 WebView 需由用户通过手机提供的系统更新渠道更新。

版本选择依据：[AGP 8.7 官方兼容表](https://developer.android.com/build/releases/agp-8-7-0-release-notes)确认支持 API 35、Gradle 8.9 和 JDK 17；[WebKit 官方发布记录](https://developer.android.com/jetpack/androidx/releases/webkit#1.12.1)确认 1.12.1 为稳定补丁版本。

## 源码与构建

`dist/` 是网页与安卓共同使用的账本源码。`node scripts/android-prepare.mjs` 将指定的八个运行资源复制到 `android/app/src/main/assets/`，并生成 Android 启动图标。复制范围不包含下载介绍页、APK、服务工作线程或其他发布文件。生成目录已被 Android 项目自己的 `.gitignore` 排除。

使用 Node.js 22、JDK 17、Gradle 8.9、Android SDK Platform 35 与 Build Tools 35.0.0，在仓库根目录运行：

```powershell
npm test
node scripts/android-prepare.mjs
gradle -p android --no-daemon assembleRelease
```

构建输出为 `android/app/build/outputs/apk/release/app-release-unsigned.apk`。它是待签名产物，不能直接安装。CI 不处理发行私钥；发行密钥仅在维护者本机 `.local/signing/` 生成并保管，此目录已被 Git 忽略。

正式发行通过 `node scripts/android-sign.mjs <unsigned.apk>` 使用本机密钥签名，输出到 `download-site/`，并生成 `release.json` 和 `.apk.sha256`。签名库是 Google Maven 的 `com.android.tools.build:apksig:8.7.3`，保存在 `.local/tools/`。后续更新必须保留 `.local/signing/` 中同一把密钥和配置、保持包名不变并增加 versionCode，才能覆盖安装并保留既有账本。不要将发行密钥、密码或证书私钥上传到 GitHub。

## 自动构建与设备检查

[Android 构建工作流](../.github/workflows/android.yml)在相关源码变更或手动触发时执行 Node 测试、准备资源、编译 release 并检查 APK 权限，然后按 package.json 中版本号上传 `yiri-android-unsigned-<version>` artifact。该 artifact 仅供维护者后续签名，下载 artifact 本身通常需要 GitHub 登录；它不应作为面向用户的公开下载地址。

推送相关源码时会自动运行设备检查，手动执行工作流时也可勾选 `smoke_test`。这个独立任务在 release artifact 已产出后，使用 Android 35 模拟器检查：

- 关闭 Wi-Fi 和移动数据后，离线页面可以首次打开。
- 通过实际页面填写一笔支出，系统返回键返回小类页面。
- 强制停止并重新启动后，金额仍保留。
- APK 未注册服务工作线程；超过 1 MiB 的原生导出请求被拒绝。
- 月计划保存、支出统计和安卓版设置界面均可打开。
- 旧 schema 1 日账本升级保留金额；月/年实际保存后，选择同月另一日期仍读取同一条记录；年展示可打开。

模拟器任务仅检查 debug 包，调试接口不会在正式 release 中开启。检查脚本位于 `android/scripts/emulator-smoke.mjs`，结果和截图作为独立 artifact 保存。是否通过以实际工作流记录为准，源码包含该流程不代表设备检查已经运行。

## 原生适配约定

资源通过 `WebViewAssetLoader` 映射到 `https://appassets.androidplatform.net/assets/index.html`，没有真正向这个域名发起网络请求。页面资源只允许同一本地来源，其他子资源返回 403；外部 HTTP(S) 跳转交给手机浏览器。WebView 关闭 `file://`、`content://` 和跨文件来源访问，保留 DOM storage，禁止在应用销毁时清空账本。

原生提供三个 `AndroidApp` 方法：

| 方法 | 行为 |
| --- | --- |
| `isNative()` | 返回 `true`，供网页隐藏安装 PWA 提示、跳过 SW 注册 |
| `saveText(name, mime, text)` | 仅接受 JSON / CSV；UTF-8 最大 1 MiB；通过系统“另存为”界面选择位置 |
| `exitApp()` | 由网页返回逻辑核对草稿后结束当前应用界面 |

导出取消、成功或失败通过 `window.YiriNativeExportResult(boolean, message)` 回传。打开系统保存窗口时，应用将待保存内容临时存入私有缓存，以应对 Activity 或进程在文件选择期间重建；操作结束后清除临时副本。账本原数据始终保留。

系统返回键调用 `window.YiriNativeBack()`，由网页关闭弹窗、检查未保存内容并返回上级页面；在首页由网页调用 `AndroidApp.exitApp()`。`WebChromeClient` 提供原生确认与提醒窗口。Activity 对系统栏、刘海和输入法区域应用 insets，避免导航和金额输入被遮挡。

实现依据：[官方本地资源方案](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content)、[WebView 对话框行为](https://developer.android.com/reference/android/webkit/WebChromeClient)、[系统文档保存流程](https://developer.android.com/training/data-storage/shared/documents-files)、[原生桥接安全建议](https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges)。

## 安装、备份和下载地址

用户应使用手机浏览器打开公开下载页，下载已经签名的 `.apk`，再按手机提示允许该浏览器安装此应用。正式包不会要求授予文件全盘访问、联系人、定位或联网权限。

浏览器网页账本与 APK 账本分属不同存储，不会自动共享数据。清除应用数据或卸载应用会移除本机账本，应先从“我的账本”导出 JSON 备份。当前功能是否支持备份导入，以页面说明为准。

用户目前没有云账号和域名，暂不进行国内平台实名认证，并明确接受 GitHub 发布安装包。因此当前入口为 [GitHub Releases](https://github.com/mik1e80/College-Student-Life-Management-Tool/releases/tag/v1.4.1)。不把 GitHub 地址标注为“中国大陆保证可达”；尚未进行大陆手机网络实测。应用安装后的离线使用不依赖下载站点。

`download-site/` 同时包含 APK、校验信息和独立下载介绍页；发行附件中的 `yiri-download-page-<version>.zip` 可解压部署到后续选择的静态托管服务。GitHub Release 由 [发行工作流](../.github/workflows/release.yml) 读取当前版本、校验实际签名与文件哈希后发布，无发行私钥进入 CI。
