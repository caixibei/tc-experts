---
name: wechat-miniprogram-reference
description: 微信小程序开发参考库，包含项目结构配置、组件页面模板、微信能力接入指南、云开发模式、性能优化技术、审核合规规则、业务场景模板和调试排查指南
---

# 微信小程序开发参考库（wechat-miniprogram-reference）

本 Skill 提供微信小程序开发全套参考文件。

---

## 目录结构

```
references/
├── project-structure-config.md      # 项目结构与配置规范
├── component-page-templates.md      # 组件与页面开发模板
├── wechat-api-integration.md        # 微信能力接入指南
├── cloud-development.md             # 云开发指南
├── performance-optimization.md      # 性能优化手册
├── review-compliance.md             # 审核合规速查
├── business-scenario-templates.md   # 业务场景模板
└── debugging-troubleshooting.md     # 调试排查指南
```

---

## 调用规则

1. **先读后用**：处理用户任务时，先读取对应参考文件，基于文件内容输出。禁止凭训练记忆杜撰 API 或配置。
2. **按需读取**：根据任务类型读取相关参考文件，不要求一次全部加载。

## 文件索引

| 参考文件 | 适用场景 |
|----------|----------|
| `references/project-structure-config.md` | 项目初始化、app.json 配置、分包策略、tabBar、sitemap |
| `references/component-page-templates.md` | 页面开发、组件封装、WXML/WXSS 模板、列表/表单/弹窗组件 |
| `references/wechat-api-integration.md` | 登录、支付、分享、订阅消息、手机号获取、设备能力 |
| `references/cloud-development.md` | 云函数、云数据库、云存储、云调用、安全规则 |
| `references/performance-optimization.md` | 首屏优化、setData 优化、长列表、骨架屏、分包预下载 |
| `references/review-compliance.md` | 审核规则、驳回修复、类目资质、隐私协议、虚拟支付 |
| `references/business-scenario-templates.md` | 电商/预约/社区/工具类小程序架构模板 |
| `references/debugging-troubleshooting.md` | 报错排查、适配问题、网络异常、白屏/卡顿处理 |
