# Rights and Author Metadata Notice / 权利与作者字段说明

## Package metadata and license

清单中的提交作者与联系字段为 `FBSir <unique@u3w.com>`；随包 [MIT License](LICENSE) 使用项目署名 `FBSir contributors`，避免把本机账户名发布为权利主体。该署名是本包的公开项目归属标识，不替代平台要求的真实主体资料，也不自行证明任何个人、组织、代理、转让或雇佣关系。

随包 MIT License 明确允许任何取得本软件及相关文档副本的人使用、复制、修改、合并、发布、分发、再许可及销售副本，条件是保留版权与许可声明。本包保留了完整 LICENSE。许可证不构成法律意见、不提供不侵权保证，也不替代发布者履行平台或法律要求的声明。

## Avatar provenance record

### Active avatar (26.9.18)

| Field | Value |
| --- | --- |
| Package path | `avatars/fbsir-icon.png` |
| Declared in | `plugin.json#/avatar` |
| SHA-256 | `2a149477a4aedf44275f6b6cf6fb48f4718a63814335e1c5c1fd8a337b9a9218` |
| Source provenance | owner-supplied file `fbs-connector.png` (64 × 64, 1,212 bytes) from the host connector marketplace icon set, supplied by the package owner for this release |
| Package transform | **resampled 8× by the package author for this release**: converted to RGBA, LANCZOS resampling performed in premultiplied-alpha space, then RGB snapped to the source's 4-colour palette. This is a bitmap upscale, **not** a vector reconstruction. |
| Format and dimensions | PNG, 512 × 512, 79,112 bytes |
| Known limitation | the diagonal stripe edges are mildly softened by the 8× upscale; a vector (AI/EPS/SVG) source should replace it if available |
| Semantic change | the previous avatar was a lockup of the graphic mark **plus** the “福帮手 FBSir” wordmark; the active avatar is the **graphic mark only** |

本记录只证明候选包内头像的当前物理字节与其输入文件。它不证明原始创作、授权链或该图标与品牌方的权利关系；**图标权利归属需由发布者向品牌方确认**。变换过程已如实披露，包括“位图放大而非矢量重建”这一限制。

### Retained avatar (not declared)

| Field | Value |
| --- | --- |
| Package path | `avatars/fbsir-standard-logo.png` |
| SHA-256 | `768d6e89452a11fef751c6ae1bbd21dc057586fc5670124eeb30ad5fbdb4d6d9` |
| Source provenance | carried forward byte-for-byte from the listed 26.8.26 package; original owner-supplied source and rights evidence were not re-observed in this workspace |
| Package transform | none in this alignment; the prior 1200×1200 source and downsample process are unverified historical metadata and are not asserted here |
| Format and dimensions | PNG, 512 × 512, 39,610 bytes |
| Status | retained in the package but **no longer referenced** by `plugin.json#/avatar` |

本记录只证明候选包内该头像的当前物理字节及其与 listed 26.8.26 包的连续性，不证明原始创作、授权链或历史变换过程。

## User materials and generated output

用户应仅提供其有权处理的材料。专家不会把用户输入、受限引文或第三方作品自动纳入包体许可证。生成结果可能受到输入材料、适用法律、平台规则和第三方权利影响，用户在公开使用前仍应完成必要的 rights clearance 与人工复核。

隐私与敏感数据处理见 [Privacy](PRIVACY.md)，安全边界见 [Security](SECURITY.md)。
