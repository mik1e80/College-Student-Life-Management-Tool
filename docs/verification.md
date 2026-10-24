# 验证记录

日期：2026-10-25，开发环境 Windows / Node.js，手机窄屏浏览器预览。

## 自动测试

运行 `node --test tests/*.test.mjs`：18 项通过、0 项失败（14 项核心规则、4 项离线与资源测试）。

覆盖初始分类和小类、整数分与非法金额、月中生效和历史预算、同日预算修改、未来月计划、批量预算原子校验、今日修改和跨日锁定、历史一次补录（含 0 元）、禁止未来和创建前日期记账、未记录与零值区分、未设预算实际统计、自定义分类、闰年和跨年、持久化数据校验。

离线测试核对全部缓存资源存在、PNG 尺寸与安装清单匹配、离线导航与脚本回退、忽略跨域和写请求、升级时保留其他应用缓存。这些是模拟 Service Worker 生命周期的单元测试，不能替代真机离线验证。

`node --check dist/app.js`、`node --check dist/core.js`、`node --check dist/sw.js` 均通过。静态服务器首页 HTTP 200。

## 浏览器操作验证

| 流程 | 实际结果 |
| --- | --- |
| 首次打开 | 八个大类、三个餐饮小类；金额缺失显示未设置 / 未记录 |
| 月计划 | 早餐 8、午餐 15、晚餐 12；10 月 25 日至 31 日预计合计 245 元 |
| 进入餐饮 | 三餐显示各自预算，末尾有添加小类 |
| 记录早餐 | 实际 9.50 元，预计 8 元；差值 −1.50 元 |
| 新建小类 | 「零食」成功保存，新小类无默认预算和实际金额 |
| 月统计 | 预计 245、实际 9.50、配对项目结余 −1.50；提示 3 项待记录 |
| 日统计 | 切换后预计为当天 35 元，实际 9.50 元，配对结余仍为 −1.50 元 |
| 手机窄屏 | 304 CSS 像素宽度下，页面滚动宽度同为 304，无横向溢出 |

上述操作使用开发服务器的人工测试数据，不打包进入正式应用。正式站点首次打开为新账本。

操作后未捕获到浏览器控制台错误。截图见 [主页](screenshots/home-mobile.png) 和 [月统计](screenshots/month-report.png)。

## 验证边界

核心跨日、历史补录和历史预算规则通过注入日期进行自动测试，没有修改设备时间。尚未在真实 Android / iPhone 上执行安装、长时间离线或跨午夜运行。不能把配置和单元测试通过等同于所有手机环境均已验证。

数据不跨设备同步，完整备份目前只可导出。个人本地账本的锁定限制不防止手动修改浏览器存储或设备时钟。

## 远程验证

GitHub Actions [首次运行](https://github.com/mik1e80/College-Student-Life-Management-Tool/actions/runs/40112186290) 已返回 completed / success，对应源码 `648f2fdf56ac62830be9094a53e3ad3898fba6d1`。Sites 发布状态已返回 succeeded；首次发布的私有登录门禁属于当时验证结果。

随后按用户要求将站点改为公开访问。Sites 返回 `access_mode=public`、访问策略 `revision=2`；浏览器新标签页直接打开正式地址，显示应用主页，无需登录。见 [公开访问截图](screenshots/public-home.png)。此次仅改变访问权限并同步文档，未修改应用资源；详细记录见 [发布记录](deployment.md)。

## Android 1.1.0

[构建及模拟器工作流](https://github.com/mik1e80/College-Student-Life-Management-Tool/actions/runs/40113988722)的 `build` 与 `smoke` 均成功，对应源码 `dc48947a74cefb23f461ea31d517769c262e7dbf`。构建中再次运行 18 项单元测试，检查 release APK 没有申请联网或全盘文件权限。

Android 35 模拟器检查 debug 包在关闭 Wi-Fi 和移动数据后首次打开，填写实际金额、系统返回、强制停止重启后记录保留；保存月计划、查看支出统计和原生设置界面；未注册 Service Worker，拒绝超过 1 MiB 的原生导出请求。

unsigned release 下载到本机后单独签名。Google apksig 8.7.3 返回 verified=true，v2 / v3 有效；发布文件大小 945852 字节，SHA-256 `4be20a6e3c5b4a5db078fb1bf9d71a8530ba39d58b2058e00b9337ff71598a57`。`node scripts/verify-release.mjs` 核对元数据、大小、哈希和 sidecar 通过。发行流程还会独立用 Android SDK apksigner 验证实际签名。

模拟器验证不等同于实体手机验证。未在大陆运营商网络实测 GitHub 下载表现；用户已接受使用 GitHub Releases 发布。
