# 调试排查指南

## 一、常见报错速查

### 网络请求类

| 报错信息 | 原因 | 解决方案 |
|----------|------|----------|
| `request:fail url not in domain list` | 域名未配置 | 在小程序后台配置合法域名 |
| `request:fail timeout` | 请求超时 | 检查网络/服务端响应/增加超时时间 |
| `request:fail -1` | 网络不可用 | 检查用户网络连接 |
| `errcode: 40001` | access_token 无效 | token 过期，重新获取 |
| `errcode: 40014` | access_token 不合法 | 检查 appId/appSecret 是否正确 |

### 页面/组件类

| 报错信息 | 原因 | 解决方案 |
|----------|------|----------|
| `Page is not constructed` | 页面路径错误 | 检查 app.json pages 配置 |
| `Component is not defined` | 组件未注册 | 检查页面 json 的 usingComponents |
| `setData` 数据量过大 | 单次传输超256KB | 拆分数据，只传变化字段 |
| `Can not find page` | 页面不存在 | 检查路径是否正确 |
| `Exceed max page stack` | 页面栈超10层 | 用 redirectTo/switchTab 替代 |

### 云开发类

| 报错信息 | 原因 | 解决方案 |
|----------|------|----------|
| `cloud.callFunction:fail` | 云函数调用失败 | 检查云函数是否部署 |
| `errcode: -501001` | 云函数执行超时 | 优化函数性能或拆分 |
| `errcode: -601002` | 数据库权限不足 | 检查安全规则设置 |
| `collection not exists` | 集合不存在 | 先在控制台创建集合 |
| `permission denied` | 无操作权限 | 检查数据库安全规则 |

---

## 二、调试工具使用

### 开发者工具调试

```
1. Console 面板 → 查看日志、报错
2. Sources 面板 → 断点调试
3. Network 面板 → 网络请求分析
4. AppData 面板 → 查看/修改页面数据
5. Storage 面板 → 查看本地缓存
6. Audit 面板 → 性能/体验评分
```

### 真机调试

```javascript
// 开启实时日志（调试用）
// 在小程序管理后台 → 运维中心 → 实时日志 中查看
// 注意：上线前删除 console.log

// 错误监控
App({
  onError(err) {
    // 上报错误到服务端
    wx.cloud.callFunction({
      name: 'reportError',
      data: {
        error: err.message || String(err),
        stack: err.stack,
        page: getCurrentPages().pop()?.route,
        time: Date.now()
      }
    });
  }
});
```

### vConsole（小程序内置）

```javascript
// 开发版/体验版自动开启 vConsole
// 在开发者工具 → 详情 → 本地设置 → 打开调试面板

// 代码中开启（仅调试用）
const log = wx.getLogManager({ level: 0 }); // 0=ALL
log.info('调试信息');
```

---

## 三、多端适配问题

### iOS vs Android 差异

| 差异点 | iOS | Android | 解决方案 |
|--------|-----|---------|----------|
| 安全区 | 底部有 home indicator | 无 | 使用 safe-area-inset |
| 键盘 | 不顶起页面 | 顶起页面 | 监听键盘事件适配 |
| 滚动 | 弹性滚动 | 非弹性 | 统一用 scroll-view |
| 时间 | `new Date("2026-09-15")` 可能返回 NaN | 正常 | 用 `2026/09/15` 格式 |
| 复制 | 长按复制 | 长按复制 | 测试两端效果 |
| Canvas | 离屏渲染 | 同步渲染 | 注意绘制完成时机 |

### 屏幕适配

```css
/* 不同屏幕宽度适配 */
/* iPhone SE (375px) → iPhone 15 Pro Max (430px) */

/* 使用 rpx 自动适配 */
.container {
  width: 750rpx;         /* 占满屏幕宽度 */
  padding: 0 32rpx;      /* 左右边距 */
}

/* 固定高度用 vh/vw */
.hero-banner {
  height: 50vh;          /* 屏幕一半高度 */
}

/* 媒体查询（特殊适配） */
@media (max-width: 375px) {
  .title { font-size: 32rpx; }
}
@media (min-width: 414px) {
  .title { font-size: 36rpx; }
}
```

### 键盘适配

```javascript
// 监听键盘高度变化
Page({
  data: {
    keyboardHeight: 0
  },

  onKeyboardHeightChange(e) {
    this.setData({
      keyboardHeight: e.height
    });
  },

  onLoad() {
    wx.onKeyboardHeightChange(this.onKeyboardHeightChange);
  },

  onUnload() {
    wx.offKeyboardHeightChange(this.onKeyboardHeightChange);
  }
});
```

```xml
<!-- 底部输入框被键盘遮挡时 -->
<view class="input-area" style="bottom: {{keyboardHeight}}px;">
  <input placeholder="输入内容" />
</view>
```

---

## 四、网络请求异常处理

### 请求封装模板

```javascript
// utils/request.js
const BASE_URL = 'https://api.example.com';

function request(options) {
  return new Promise((resolve, reject) => {
    const token = wx.getStorageSync('token');

    wx.request({
      url: `${BASE_URL}${options.url}`,
      method: options.method || 'GET',
      data: options.data,
      header: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : '',
        ...options.header
      },
      timeout: options.timeout || 10000,
      success(res) {
        if (res.statusCode === 200) {
          resolve(res.data);
        } else if (res.statusCode === 401) {
          // token 过期，重新登录
          wx.removeStorageSync('token');
          wx.navigateTo({ url: '/pages/login/login' });
          reject(new Error('登录已过期'));
        } else {
          reject(new Error(`请求失败: ${res.statusCode}`));
        }
      },
      fail(err) {
        if (err.errMsg.includes('timeout')) {
          reject(new Error('请求超时，请稍后重试'));
        } else if (err.errMsg.includes('url')) {
          reject(new Error('请求地址异常'));
        } else {
          reject(new Error('网络异常，请检查网络'));
        }
      }
    });
  });
}

// 带重试的请求
async function requestWithRetry(options, maxRetry = 2) {
  for (let i = 0; i <= maxRetry; i++) {
    try {
      return await request(options);
    } catch (err) {
      if (i === maxRetry) throw err;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

module.exports = { request, requestWithRetry };
```

---

## 五、白屏/卡顿排查

### 白屏排查流程

```
1. 打开 vConsole / 开发者工具 Console
   → 是否有 JS 报错？
   → 有报错：定位报错行修复
   → 无报错：继续

2. 检查数据是否加载完成
   → setData 是否成功？
   → 数据为空：检查接口/云函数
   → 数据正常：继续

3. 检查页面渲染
   → WXML 条件渲染是否正确？
   → wx:if / wx:for 条件是否有误？
   → 组件是否正确注册？

4. 检查网络请求
   → Network 面板查看请求状态
   → 接口是否返回错误？
   → 域名是否在白名单？

5. 检查基础库版本
   → 是否使用了低版本不支持的API？
   → 查看 app.json 中最低基础库版本
```

### 卡顿排查

```javascript
// 性能监控 - 找出卡顿原因
const performance = wx.getPerformance();
const observer = performance.createObserver((entryList) => {
  const entries = entryList.getEntries();

  entries.forEach(entry => {
    // 筛选耗时 > 100ms 的操作
    if (entry.duration > 100) {
      console.warn(`⚠️ 慢操作: ${entry.name} 耗时 ${entry.duration}ms`);
    }
  });
});

observer.observe({ entryTypes: ['render', 'script', 'navigation'] });
```

### 常见卡顿原因

| 原因 | 排查方法 | 解决方案 |
|------|----------|----------|
| setData 数据量大 | 监控 setData 耗时 | 只传变化字段，控制 < 256KB |
| 频繁 setData | 检查 onShow/scroll 中的 setData | 节流/防抖 |
| 长列表未优化 | 检查列表数据量 | 虚拟列表或分页 |
| 图片过多过大 | 检查页面图片数量 | 懒加载 + 压缩 |
| 复杂计算阻塞 | 检查 JS 执行耗时 | Web Worker 或异步 |
| 组件嵌套过深 | 检查组件层级 | 扁平化组件结构 |

---

## 六、线上问题排查

```javascript
// 错误监控 + 上报
App({
  onError(err) {
    this.reportError('JS_ERROR', {
      message: err.message,
      stack: err.stack,
      page: this._currentPage
    });
  },

  onPageNotFound(res) {
    this.reportError('PAGE_NOT_FOUND', {
      path: res.path,
      isEntry: res.isEntryPage
    });
  },

  // 统一上报
  async reportError(type, data) {
    try {
      await wx.cloud.callFunction({
        name: 'reportError',
        data: {
          type,
          data,
          platform: wx.getSystemInfoSync().platform,
          SDKVersion: wx.getSystemInfoSync().SDKVersion,
          version: this._appVersion,
          time: Date.now()
        }
      });
    } catch (e) {
      console.error('错误上报失败:', e);
    }
  }
});
```
