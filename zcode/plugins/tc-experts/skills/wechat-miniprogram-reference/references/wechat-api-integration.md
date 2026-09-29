# 微信能力接入指南

## 一、登录流程

### 静默登录（获取 openid）

```
前端                          服务端
  |                              |
  |-- wx.login() -->             |
  |<-- code --------------------|
  |                              |
  |-- code + appId + secret ---->|
  |                              |-- code2Session API -->
  |                              |<-- openid + session_key --
  |                              |
  |<-- 自定义登录态(token) ------|
  |                              |-- 存储 session_key(服务端) --
```

**前端代码：**
```javascript
// utils/auth.js
async function login() {
  try {
    const { code } = await wx.login();
    const res = await wx.cloud.callFunction({
      name: 'userLogin',
      data: { code }
    });
    const { token, openid } = res.result;

    // 存储登录态
    wx.setStorageSync('token', token);
    wx.setStorageSync('openid', openid);

    return { token, openid };
  } catch (err) {
    console.error('登录失败:', err);
    throw err;
  }
}

// 在 app.js onLaunch 中调用
App({
  onLaunch() {
    login().catch(console.error);
  },
  globalData: { openid: '' }
});
```

**云函数代码：**
```javascript
// cloudfunctions/userLogin/index.js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const unionid = wxContext.UNIONID;

  // 查询或创建用户
  const db = cloud.database();
  const userCollection = db.collection('users');
  const { data: existingUser } = await userCollection
    .where({ openid }).limit(1).get();

  let userId;
  if (existingUser.length > 0) {
    userId = existingUser[0]._id;
    // 更新登录时间
    await userCollection.doc(userId).update({
      data: { lastLoginAt: db.serverDate() }
    });
  } else {
    const { _id } = await userCollection.add({
      data: {
        openid,
        unionid: unionid || '',
        createdAt: db.serverDate(),
        lastLoginAt: db.serverDate()
      }
    });
    userId = _id;
  }

  // 生成自定义登录态（简单示例，生产应用JWT）
  const token = `${openid}_${Date.now()}`;

  return { token, openid, userId };
};
```

### 手机号快速验证（新版）

```xml
<!-- 页面 WXML -->
<button open-type="getPhoneNumber" bindgetphonenumber="onGetPhone">
  绑定手机号
</button>
```

```javascript
Page({
  async onGetPhone(e) {
    if (e.detail.errMsg !== 'getPhoneNumber:ok') {
      wx.showToast({ title: '已取消', icon: 'none' });
      return;
    }

    const { code } = e.detail; // 新版动态令牌

    // 服务端用 code 换取手机号
    const res = await wx.cloud.callFunction({
      name: 'getPhoneNumber',
      data: { code }
    });

    const phoneNumber = res.result.phoneNumber;
    // 绑定到用户记录
    this.bindPhone(phoneNumber);
  }
});
```

---

## 二、微信支付

### 完整支付流程

**前端代码：**
```javascript
async function createOrder(orderData) {
  // 1. 调用云函数创建订单（服务端下单）
  const res = await wx.cloud.callFunction({
    name: 'createPayOrder',
    data: {
      productId: orderData.productId,
      amount: orderData.amount,    // 单位：分
      description: orderData.description
    }
  });

  const payment = res.result.payment;

  // 2. 调起微信支付
  try {
    const payRes = await wx.requestPayment(payment);
    console.log('支付成功:', payRes);

    // 3. 支付成功后的业务处理
    await onPaySuccess(res.result.orderId);
    return { success: true };
  } catch (err) {
    if (err.errMsg.includes('cancel')) {
      return { success: false, cancelled: true };
    }
    return { success: false, error: err };
  }
}
```

**云函数代码：**
```javascript
// cloudfunctions/createPayOrder/index.js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { productId, amount, description } = event;

  // 1. 创建订单记录
  const db = cloud.database();
  const orderId = `ORD_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  await db.collection('orders').add({
    data: {
      orderId,
      openid,
      productId,
      amount,
      status: 'pending',
      createdAt: db.serverDate()
    }
  });

  // 2. 调用微信支付统一下单
  const res = await cloud.cloudPay.unifiedOrder({
    body: description || '商品购买',
    outTradeNo: orderId,
    spbillCreateIp: '127.0.0.1',
    subMchId: 'YOUR_MCH_ID',  // 商户号
    totalFee: amount,          // 单位：分
    envId: cloud.DYNAMIC_CURRENT_ENV,
    functionName: 'payCallback'  // 支付回调云函数
  });

  if (res.errCode !== 0) {
    throw new Error(`下单失败: ${res.errMsg}`);
  }

  return {
    orderId,
    payment: res.payment  // 直接传给前端 wx.requestPayment
  };
};
```

**支付回调云函数：**
```javascript
// cloudfunctions/payCallback/index.js
exports.main = async (event, context) => {
  const { outTradeNo, resultCode, returnCode, totalFee } = event;

  const db = cloud.database();

  if (returnCode === 'SUCCESS' && resultCode === 'SUCCESS') {
    // 支付成功，更新订单状态
    await db.collection('orders')
      .where({ orderId: outTradeNo })
      .update({
        data: {
          status: 'paid',
          paidAt: db.serverDate(),
          paidAmount: totalFee
        }
      });

    // TODO: 执行业务逻辑（发货、更新库存等）
  }

  return { errcode: 0, errmsg: 'SUCCESS' };
};
```

---

## 三、分享转发

```javascript
Page({
  // 转发给朋友
  onShareAppMessage() {
    return {
      title: '分享标题',
      path: '/pages/index/index?shareFrom=user',
      imageUrl: '/assets/images/share-cover.png'  // 自定义分享图 5:4
    };
  },

  // 分享到朋友圈
  onShareTimeline() {
    return {
      title: '朋友圈分享标题',
      query: 'shareFrom=timeline',
      imageUrl: '/assets/images/timeline-cover.png'  // 自定义分享图 1:1
    };
  }
});
```

---

## 四、订阅消息

```javascript
// 请求订阅
async function requestSubscribe() {
  const tmplIds = ['YOUR_TEMPLATE_ID'];

  const res = await wx.requestSubscribeMessage({
    tmplIds,
    success(res) {
      // res[tmplId] 可能是 'accept' / 'reject' / 'ban'
      console.log('订阅结果:', res);
    }
  });
}

// 发送订阅消息（云函数）
async function sendSubscribeMessage(openid, templateId, data, page) {
  const res = await cloud.openapi.subscribeMessage.send({
    touser: openid,
    templateId,
    data,       // { thing1: { value: '订单已发货' }, ... }
    page        // 点击跳转的页面
  });
  return res;
}
```

---

## 五、小程序码

```javascript
// 云函数生成小程序码
async function generateWxaCode(scene, page) {
  const res = await cloud.openapi.wxacode.getUnlimited({
    scene,          // 最大32字符，如 "id=123"
    page,           // 跳转页面，如 "pages/detail/detail"
    width: 430,
    autoColor: false,
    lineColor: { r: 7, g: 193, b: 96 },
    isHyaline: false
  });

  // res.buffer 是图片 Buffer，存到云存储
  const upload = await cloud.uploadFile({
    cloudPath: `qrcodes/${scene}_${Date.now()}.png`,
    fileContent: res.buffer
  });

  return upload.fileID;
}
```

---

## 六、常用设备能力速查

| API | 用途 | 注意事项 |
|-----|------|----------|
| wx.getLocation | 获取位置 | 需授权弹窗 + privacy 声明 |
| wx.chooseImage | 选图 | 已废弃，用 wx.chooseMedia |
| wx.chooseMedia | 选图/视频 | 替代 chooseImage |
| wx.scanCode | 扫码 | 支持二维码/条形码 |
| wx.setClipboardData | 复制文本 | 复制到剪贴板 |
| wx.makePhoneCall | 拨打电话 | 需用户确认 |
| wx.getClipboardData | 读剪贴板 | 需用户授权 |
| wx.getSystemInfo | 系统信息 | 获取屏幕尺寸等 |
| wx.createCanvasContext | Canvas 绘图 | 新API用 Canvas 2D |

---

## 隐私合规要点

1. **隐私协议**：首次启动必须展示隐私协议弹窗
2. **权限申请**：必须先声明用途，用户同意后再调用
3. **requiredPrivateInfos**：在 app.json 中声明需要的隐私接口
4. **接口授权**：地理位置、手机号等接口需单独授权
5. **用户数据**：不可在用户不知情时采集/上传
