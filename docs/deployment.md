# 第一版发布记录

发布日期：2026-10-25（Asia/Shanghai）。

| 项目 | 结果 |
| --- | --- |
| 应用地址 | https://campus-life-yiri-20261025.my-team-1261.chatgpt.site |
| 当前访问范围 | 公开访问，无需登录（2026-10-25 按用户要求调整） |
| 发布状态 | Sites 原生状态查询返回 succeeded |
| 部署源码提交 | `648f2fdf56ac62830be9094a53e3ad3898fba6d1` |
| GitHub 仓库 | https://github.com/mik1e80/College-Student-Life-Management-Tool |
| 分支 | main |
| 自动测试 | 18 项通过；GitHub Actions completed / success |
| CI 记录 | https://github.com/mik1e80/College-Student-Life-Management-Tool/actions/runs/40112186290 |

部署与 GitHub 使用同一份已提交的应用资源。后续提交仅补充 README 入口和本发布记录，未修改部署资源。

首次发布时站点仅对 Sites 创建者开放，浏览器核对时可见「登录后即可访问」及「使用 ChatGPT 继续」入口。随后用户要求公开访问，已将访问范围调整为公开、无需登录。Sites 返回 `access_mode=public`、`revision=2`；新建浏览器标签页打开正式地址后直接显示「一日有数」主页和初始空白账本，无需登录。本次仅调整访问权限，无需重新部署静态资源。应用实际操作验证使用本地开发地址，详情见 [验证记录](verification.md)。

手机可直接打开正式地址，从「我的账本」查看安装方法。数据保存在手机对应浏览器，不会从电脑自动同步；公开访问不会把各设备的账本上传或共享。
