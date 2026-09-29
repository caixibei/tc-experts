# WorkBuddy 开放平台边界与 26.9.10 映射

当前公开合同快照核验于 2026-09-04：

- `https://open.workbuddy.cn/docs/expert`
- `https://open.workbuddy.cn/docs/skill`
- `https://open.workbuddy.cn/docs/buddy-app`

公开文档会变化；实际提交前必须重新核验当前字段和发布流程。

## 当前官方产品面

WorkBuddy 开放平台把能力分成五个独立产品面：Buddy 应用、专家、Skill、连接器和硬件。26.9.10 当前交付物是一个专家包，内含一个 Agent 和一个 Skill；它不是 Buddy 应用、连接器或第三方 Open API 应用。

## 当前包能交付什么

- `.codebuddy-plugin/plugin.json` 与 `agents/`：专家身份、展示、入口和用户可见行为。
- `skills/long-manuscript-core/`：可复用长文档流程、参考资料、确定性脚本和模板。
- `buddy-package/industry-research-report/`：面向未来 Buddy 应用配置的产品设计候选和固定评测素材。

`buddy-package/` 不是 WorkBuddy 官方声明的直接上传格式，也不是已创建的开放平台 Buddy 应用。除非平台当前预览、审核和版本回执覆盖同一配置，不得使用 `platform_draft`、`reviewed` 或 `published`。

## Buddy 应用映射

如果未来把“行业研究报告”升级为 Buddy 应用，应把内部设计映射到开放平台的实际配置面：

1. 创建应用：应用身份、头像、名称、简介、OAuth 授权、回调与可信 Origin。
2. 首页配置：2—4 个工作模式、3—5 个高频场景胶囊、输入占位符和可选内置连接器。
3. 市场配置：显式选择专家、Skill、连接器与精选场景；当前专家和 Skill 的稳定 ID 不因 Buddy 品牌变化而改变。
4. 模型配置：从 WorkBuddy 当前模型池选择和排序，不在专家包中锁死模型；任何模型只在目标工作流实测后进入推荐。
5. 预览调试与审核：使用平台提供的预览版本完成场景、材料、权限和产物验收；配置审核通过后才可称为上线。

## 多模态材料边界

开放平台可选择模型，不等于每个模型、每个入口或每个专家会话都已接收相同附件。模型公开能力、WorkBuddy 附件呈现、系统工具读取、OCR/ASR/解析、专家使用和产物交付必须分别记录。

26.9.10 的默认规则是：

- 用户已在当前 WorkBuddy 任务提供材料时，先利用当前真实可见/可读能力；连接器状态不阻断首值，也不要求用户先排查连接器；
- 模型或入口不能处理某模态时，退化到页图、联系表、转写、导出文本/CSV或用户提供的观察；
- 不为探测能力而把用户材料发送到新的提供商或服务；
- 外部系统读取、分享、同步、Open API、连接器和发布分别授权。

## 状态轴

保持以下状态互不推导：

```text
expert_package_candidate
workbuddy_5_5_3_host_validated
open_platform_buddy_configuration_draft
open_platform_review_submitted
review_accepted
published_or_listed
natural_use_observed
business_confirmed
```

本包当前最多可达到 `expert_package_candidate`。其余状态都要求各自的当前回执。
