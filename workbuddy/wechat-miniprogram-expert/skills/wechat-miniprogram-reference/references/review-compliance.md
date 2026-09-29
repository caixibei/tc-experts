# 审核合规速查

## 一、常见驳回原因与修复

### 类目资质问题

| 驳回原因 | 解决方案 | 所需资质 |
|----------|----------|----------|
| 缺少电商类目资质 | 补充营业执照+ICP备案 | 电商-平台类型 |
| 教育类缺少资质 | 提供办学许可证 | 教育-在线教育 |
| 医疗类缺少资质 | 提供医疗机构执业许可证 | 医疗服务 |
| 金融类缺少资质 | 提供金融许可证 | 金融-理财/保险 |
| 视频类缺少资质 | 提供信息网络传播视听节目许可证 | 文娱-视频 |

### 内容安全

| 驳回原因 | 解决方案 |
|----------|----------|
| 存在违规内容 | 使用微信内容安全API（msgSecCheck）过滤 |
| 用户可发布违规信息 | 接入内容安全检测，建立举报机制 |
| 页面含低俗/暴力内容 | 修改内容，确保合规 |

### 诱导分享

| 驳回原因 | 解决方案 |
|----------|----------|
| 强制分享才能继续 | 分享不能作为功能前置条件 |
| 分享送奖励 | 不能因分享行为直接给予奖励 |
| 诱导关注/分享话术 | 修改文案，不能用"分享得XX"等诱导表述 |
| 弹窗阻断 | 分享弹窗不能阻断用户正常操作 |

**合规的分享引导方式：**
```javascript
// ✅ 正确：自然引导，不强制
<view class="share-tip">
  <text>觉得有用？分享给朋友吧</text>
  <button open-type="share">分享</button>
</view>

// ❌ 错误：强制分享
if (!shared) {
  showModal({ title: '请先分享', content: '分享后才能查看' });
}
```

### 虚拟支付（iOS）

| 驳回原因 | 说明 |
|----------|------|
| iOS端使用微信支付购买虚拟商品 | 违反苹果 App Store 政策 |
| 虚拟商品定义 | 课程、会员、虚拟币、电子书等 |
| 解决方案 | iOS 端隐藏支付入口，或引导至公众号/H5 |

```javascript
// 检测平台并处理
const sysInfo = wx.getSystemInfoSync();
const isIOS = sysInfo.platform === 'ios';

if (isIOS && isVirtualProduct) {
  // iOS 端虚拟商品：不展示支付入口
  this.setData({ showPayButton: false });
} else {
  // Android 端或实物商品：正常支付
  this.setData({ showPayButton: true });
}
```

---

## 二、隐私协议合规

### 隐私协议弹窗模板

```javascript
// app.js
App({
  onLaunch() {
    // 检查是否需要展示隐私协议
    wx.getPrivacySetting({
      success: res => {
        if (res.needAuthorization) {
          this.showPrivacyModal();
        }
      }
    });
  },

  showPrivacyModal() {
    wx.requirePrivacyAuthorize({
      success: () => {
        // 用户同意
        console.log('隐私协议已同意');
      }
    });
  }
});
```

**或者自定义弹窗：**
```xml
<view wx:if="{{showPrivacy}}" class="privacy-modal">
  <view class="privacy-content">
    <text class="privacy-title">隐私保护提示</text>
    <text class="privacy-desc">
      在使用小程序前，请仔细阅读并充分理解
      <navigator class="link" open-type="openPrivacyContract">《隐私保护指引》</navigator>
    </text>
    <view class="privacy-btns">
      <button class="btn-reject" bindtap="onPrivacyReject">拒绝</button>
      <button class="btn-agree" bindtap="onPrivacyAgree">同意</button>
    </view>
  </view>
</view>
```

```javascript
Page({
  data: { showPrivacy: false },

  onPrivacyAgree() {
    // 调用隐私协议同意接口
    this._privacyHandler && this._privacyHandler.resolve();
    this.setData({ showPrivacy: false });
  },

  onPrivacyReject() {
    this._privacyHandler && this._privacyHandler.reject();
    this.setData({ showPrivacy: false });
    // 可以选择退出或限制功能
  }
});
```

---

## 三、隐私接口声明

### app.json 必须声明

```json
{
  "requiredPrivateInfos": [
    "getLocation",
    "chooseLocation",
    "chooseAddress",
    "onLocationChange",
    "startLocationUpdate",
    "chooseLocation"
  ],
  "permission": {
    "scope.userLocation": {
      "desc": "用于获取您的位置，推荐附近门店"
    }
  }
}
```

### 接口与声明对应关系

| 接口 | 需声明 | 需授权 |
|------|--------|--------|
| wx.getLocation | requiredPrivateInfos + permission | scope.userLocation |
| wx.chooseLocation | requiredPrivateInfos | 弹窗确认 |
| wx.chooseAddress | requiredPrivateInfos | 弹窗确认 |
| getPhoneNumber（button） | - | 用户点击触发 |
| wx.getUserProfile | - | 用户点击触发 |

---

## 四、审核前自检清单

### 基础检查

- [ ] 小程序名称/图标/描述不含违禁词
- [ ] 类目选择正确，资质已上传
- [ ] 所有页面功能正常，无空白页/404
- [ ] 测试账号可用（如有登录）
- [ ] 页面不包含外部链接（除非白名单域名）

### 功能检查

- [ ] 所有功能可在没有手机号的情况下使用（基础功能）
- [ ] 不存在诱导分享/关注的逻辑
- [ ] iOS 端虚拟商品无微信支付入口
- [ ] 用户生成的内容经过安全检测
- [ ] 支付功能有退款机制说明

### 隐私检查

- [ ] 隐私协议已配置并弹窗展示
- [ ] requiredPrivateInfos 已声明所有隐私接口
- [ ] permission 已声明权限用途说明
- [ ] 不采集与服务无关的用户信息
- [ ] 用户可主动注销账号

### 体验检查

- [ ] 无强制登录（核心功能不依赖登录）
- [ ] 加载状态有反馈（loading/骨架屏）
- [ ] 空状态有引导
- [ ] 错误提示友好，不露技术错误
- [ ] 适配主流机型（iPhone SE ~ iPhone 15 Pro Max）

---

## 五、审核加速建议

1. **完善测试账号**：提供可正常登录的测试账号
2. **功能说明**：在审核备注中说明核心功能和使用场景
3. **资质齐全**：提前准备好所有类目所需资质
4. **小步迭代**：每次提交改动不要太大，降低审核复杂度
5. **避免敏感词**：名称和描述避免政治、宗教、赌博等敏感词
6. **首次提审**：首次提审可能需要1-3个工作日，后续通常几小时内

---

## 六、⚠️ 重要提示

以上审核规则基于微信常见驳回场景整理。**微信平台政策会持续更新，具体以微信官方最新文档为准：**
- [微信小程序运营规范](https://developers.weixin.qq.com/miniprogram/product/reject.html)
- [微信小程序类目资质](https://developers.weixin.qq.com/miniprogram/product/material/category.html)
- [微信小程序隐私接口](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/privacy.html)

**涉及审核问题时，务必核实最新政策后再给方案。**
