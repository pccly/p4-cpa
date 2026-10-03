# P4 CPA manager

采用 Kiln 主题与 Ember core 标识的 P4 CPA 管理面板。
本目录是 [P4 CPA](https://github.com/pccly/p4-cpa) 的管理器子树。

- [安装与配置](../README.md)
- [私有托管、备份与升级](../docs/hosting.md)
- [English](README.md)

## 开发

在本目录运行 `npm ci`，然后使用 `npm run dev` 启动面板，或使用
`npm run dev:demo` 查看虚构演示数据。`npm run build` 构建面板。
在仓库根目录运行 `docker compose build cpa-manager-plus` 构建完整管理器镜像。

## 上游与更新

基于 [CPA Manager Plus](https://github.com/seakee/CPA-Manager-Plus)，初始导入版本为
v1.14.2。`apps/docs/` 保留上游操作手册；本私有部署请以根目录文档为准。

P4 CPA 从 1.0.0 开始独立发布，已停用上游更新提示。参见[上游来源与发布策略](../docs/upstream.md)。审阅源码变更并按照根目录指南重新构建
本地镜像。上游安装脚本、镜像和发布包不包含 P4 CPA 品牌与部署配置。
环境变量、API 请求头及存储标识保持兼容。

上游版权与 MIT 条款保留于 [LICENSE](LICENSE) 和 [NOTICE](../NOTICE)。
