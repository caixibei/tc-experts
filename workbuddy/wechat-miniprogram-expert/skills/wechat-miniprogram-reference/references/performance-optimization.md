# 性能优化手册

## 一、首屏加载优化

### 优化检查清单

| 优化项 | 方法 | 预期效果 |
|--------|------|----------|
| 分包加载 | 主包只放首页+tabBar，其他分包 | 主包体积减少50%+ |
| 分包预下载 | preloadRule 进入首页时预下载分包A | 分包切换零等待 |
| 独立分包 | 独立分包可脱离主包运行 | 特定页面极速打开 |
| 骨架屏 | 数据加载前展示占位骨架 | 感知加载速度提升 |
| 数据预拉取 | app.js 中 onLaunch 预拉取首页数据 | 首屏数据秒开 |
| 图片优化 | WebP格式+懒加载+CDN | 图片加载提速30%+ |
| 按需注入 | lazyCodeLoading: "requiredComponents" | 减少启动耗时 |

### 数据预拉取模板

```javascript
// app.js
App({
  onLaunch() {
    // 预拉取首页数据
    wx.preFetch && wx.preFetch({
      url: 'https://api.example.com/home',
      complete(res) {
        console.log('预拉取完成:', res);
      }
    });
  }
});

// pages/index/index.js
Page({
  data: {
    homeData: null,
    loading: true
  },

  async onLoad() {
    // 优先使用预拉取数据
    if (this.data.homeData) {
      this.setData({ loading: false });
      return;
    }

    // 否则走正常请求
    await this.loadData();
  }
});
```

---

## 二、setData 优化

### 核心原则

1. **只传变化的字段**，不要传整个 data
2. **合并多次 setData**，避免连续调用
3. **大数据用局部更新路径**
4. **列表渲染用 key 标识**

### 错误 vs 正确写法

```javascript
// ❌ 错误：传了整个 data
this.setData({
  list: newList,
  page: this.data.page + 1,
  loading: false,
  hasMore: true,
  filter: this.data.filter,    // 没变！
  title: this.data.title       // 没变！
});

// ✅ 正确：只传变化的字段
this.setData({
  list: newList,
  page: this.data.page + 1,
  loading: false,
  hasMore: true
});
```

```javascript
// ❌ 错误：列表全量更新
this.setData({ list: newList });

// ✅ 正确：局部路径更新
this.setData({ [`list[${index}].liked`]: true });
```

### 大数据优化策略

```javascript
// 长列表分段渲染
function renderLongList(fullList) {
  const CHUNK_SIZE = 20;
  let index = 0;

  function renderChunk() {
    const chunk = fullList.slice(index, index + CHUNK_SIZE);
    this.setData({
      [`list[${index}]`]: chunk
    });
    index += CHUNK_SIZE;

    if (index < fullList.length) {
      requestAnimationFrame(renderChunk.bind(this));
    }
  }

  renderChunk.call(this);
}
```

---

## 三、长列表优化

### 虚拟列表方案

```javascript
// 只渲染可视区域内的 item
Page({
  data: {
    allList: [],        // 全量数据
    renderList: [],     // 当前渲染的数据
    startIndex: 0,
    itemHeight: 100,    // 每项高度(rpx)
    screenHeight: 0
  },

  onLoad() {
    const sysInfo = wx.getSystemInfoSync();
    const itemHeightPx = sysInfo.windowWidth * 100 / 750; // rpx转px
    const visibleCount = Math.ceil(sysInfo.windowHeight / itemHeightPx) + 2;

    this.setData({
      itemHeight: 100,
      visibleCount,
      screenHeight: sysInfo.windowHeight
    });
  },

  onPageScroll(e) {
    const scrollTop = e.scrollTop;
    const itemHeightPx = this.data.itemHeight * wx.getSystemInfoSync().windowWidth / 750;
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeightPx) - 2);
    const endIndex = startIndex + this.data.visibleCount;

    this.setData({
      startIndex,
      renderList: this.data.allList.slice(startIndex, endIndex),
      offsetY: startIndex * itemHeightPx
    });
  }
});
```

```xml
<!-- 虚拟列表 WXML -->
<scroll-view scroll-y style="height: 100vh;" bindscroll="onPageScroll">
  <view style="height: {{allList.length * itemHeight}}rpx; position: relative;">
    <view style="transform: translateY({{offsetY}}px);">
      <view wx:for="{{renderList}}" wx:key="id" style="height: {{itemHeight}}rpx;">
        {{item.name}}
      </view>
    </view>
  </view>
</scroll-view>
```

---

## 四、图片优化

### 懒加载

```xml
<!-- 图片懒加载 -->
<image src="{{item.url}}" lazy-load mode="aspectFill" />

<!-- 渐进式加载（先低质量占位，后加载原图） -->
<image
  src="{{loaded ? item.url : item.placeholderUrl}}"
  lazy-load
  bindload="onImageLoad"
  data-index="{{index}}"
/>
```

### 图片格式建议

| 场景 | 格式 | 说明 |
|------|------|------|
| 照片/复杂图 | WebP | 体积比PNG小30%+ |
| 图标/简单图形 | SVG（通过iconfont） | 矢量无失真 |
| tabBar图标 | PNG | 兼容性最好 |
| 动图 | 帧动画 或 Lottie | 避免GIF（体积大） |

---

## 五、内存管理

### 常见问题与解决

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 内存溢出 | data 过大 | 减少 data 存储，用变量存大数据 |
| 页面栈溢出 | navigateTo 超10层 | 用 redirectTo 或 switchTab |
| 定时器泄漏 | 未清理 setInterval | onUnload 中 clearInterval |
| 事件监听泄漏 | 未移除监听 | onUnload 中 wx.offXxx |

```javascript
// 内存泄漏预防模板
Page({
  _timer: null,
  _observer: null,

  onLoad() {
    this._timer = setInterval(() => {
      this.checkStatus();
    }, 5000);

    // IntersectionObserver 用完要 disconnect
    this._observer = this.createIntersectionObserver();
    this._observer.observe('.target', (res) => {
      if (res.intersectionRatio > 0) {
        this.loadContent();
      }
    });
  },

  onUnload() {
    // 清理定时器
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    // 清理观察器
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
  }
});
```

---

## 六、性能监控

```javascript
// 性能数据获取
Page({
  onReady() {
    const performance = wx.getPerformance();
    const observer = performance.createObserver((entryList) => {
      const entries = entryList.getEntries();
      entries.forEach(entry => {
        console.log(`${entry.name}: ${entry.duration}ms`);
      });
    });
    observer.observe({ entryTypes: ['render', 'script', 'navigation'] });
  }
});
```

### 关键性能指标

| 指标 | 目标值 | 说明 |
|------|--------|------|
| 首次渲染 | < 1s | 首屏内容渲染完成 |
| setData 耗时 | < 100ms | 单次 setData 同步时间 |
| 页面切换 | < 300ms | 页面跳转完成时间 |
| 主包大小 | < 1.5MB | 主包体积 |
| setData 数据量 | < 256KB | 单次传输数据大小 |
