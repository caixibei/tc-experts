# 转录质量门与交付准备

来源忠实度固定使用三个机器可验证门：

| 门 | 检查内容 | 失败影响 |
|---|---|---|
| `page-sequence.integrity` | 页覆盖、唯一主来源、观察顺序、方向 | 阻断 |
| `transcription.fidelity` | 原始观察绑定、来源复核、代表性抽样、裁决与修正证明 | 阻断或转人工 |
| `ocr-artifact.suspect` | U+FFFD、NUL、疑似OCR碎片及未关闭问题 | 阻断或转人工 |

门实现文件由 `sha256_utf8_lf_v1` 绑定，因此 Windows 的 CRLF 安装转换不会破坏实现身份；字符、空格或逻辑变化仍失败。

`SourceFidelityStatus.dimensions.delivery=ready_for_host_delivery` 只证明内存快照已满足包内条件并与 `deliverySnapshotDigest` 一致。它不证明宿主已保存文件、文件可打开、官方上架、真实OCR执行或用户交付。宿主若要落盘，应另行产生写入授权、物理回读和可回滚回执。

连接器、企业微信、FBS端口与外部服务均不是来源忠实首值的依赖。
