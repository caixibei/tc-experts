# 组件与页面开发模板

## 页面标准模板

### Page JS 模板

```javascript
Page({
  data: {
    list: [],
    loading: false,
    page: 1,
    hasMore: true,
    refreshing: false
  },

  onLoad(options) {
    // 接收页面参数
    this.loadData();
  },

  onShow() {
    // 页面显示时刷新数据
  },

  onPullDownRefresh() {
    this.setData({ page: 1, hasMore: true });
    this.loadData(true);
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      this.setData({ page: this.data.page + 1 });
      this.loadData();
    }
  },

  async loadData(isRefresh = false) {
    if (this.data.loading) return;
    this.setData({ loading: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'getData',
        data: { page: this.data.page, size: 10 }
      });

      const newList = isRefresh ? res.result : [...this.data.list, ...res.result];
      this.setData({
        list: newList,
        hasMore: res.result.length >= 10,
        loading: false,
        refreshing: false
      });

      if (isRefresh) wx.stopPullDownRefresh();
    } catch (err) {
      console.error('加载失败:', err);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  onShareAppMessage() {
    return {
      title: '分享标题',
      path: '/pages/index/index',
      imageUrl: '' // 自定义分享图
    };
  }
});
```

### 列表页面 WXML 模板

```xml
<view class="page">
  <!-- 骨架屏 -->
  <view wx:if="{{loading && list.length === 0}}" class="skeleton">
    <view wx:for="{{[1,2,3,4,5]}}" wx:key="*this" class="skeleton-item">
      <view class="skeleton-img"></view>
      <view class="skeleton-content">
        <view class="skeleton-title"></view>
        <view class="skeleton-desc"></view>
      </view>
    </view>
  </view>

  <!-- 列表内容 -->
  <view wx:else class="list">
    <view
      wx:for="{{list}}"
      wx:key="id"
      class="list-item"
      bindtap="onItemTap"
      data-id="{{item.id}}"
    >
      <image class="item-img" src="{{item.image}}" mode="aspectFill" lazy-load />
      <view class="item-content">
        <text class="item-title">{{item.title}}</text>
        <text class="item-desc">{{item.description}}</text>
        <view class="item-footer">
          <text class="item-price">¥{{item.price}}</text>
          <text class="item-extra">{{item.extra}}</text>
        </view>
      </view>
    </view>

    <!-- 加载状态 -->
    <view class="load-more">
      <view wx:if="{{loading}}" class="loading-spinner"></view>
      <text wx:elif="{{!hasMore}}" class="no-more">没有更多了</text>
    </view>

    <!-- 空状态 -->
    <view wx:if="{{list.length === 0 && !loading}}" class="empty">
      <image class="empty-img" src="/assets/images/empty.png" />
      <text class="empty-text">暂无数据</text>
    </view>
  </view>
</view>
```

---

## 常用组件模板

### 1. 自定义导航栏（nav-bar）

**JSON:**
```json
{
  "component": true
}
```

**JS:**
```javascript
Component({
  properties: {
    title: { type: String, value: '' },
    back: { type: Boolean, value: true },
    bgColor: { type: String, value: '#ffffff' },
    textColor: { type: String, value: '#333333' }
  },

  data: {
    statusBarHeight: 0,
    navBarHeight: 44
  },

  lifetimes: {
    attached() {
      const sysInfo = wx.getSystemInfoSync();
      this.setData({
        statusBarHeight: sysInfo.statusBarHeight
      });
    }
  },

  methods: {
    onBack() {
      const pages = getCurrentPages();
      if (pages.length > 1) {
        wx.navigateBack();
      } else {
        wx.switchTab({ url: '/pages/index/index' });
      }
    }
  }
});
```

**WXML:**
```xml
<view class="nav-bar" style="background:{{bgColor}}; padding-top:{{statusBarHeight}}px;">
  <view class="nav-content" style="height:{{navBarHeight}}px;">
    <view wx:if="{{back}}" class="nav-back" bindtap="onBack">
      <text class="back-icon" style="color:{{textColor}}">←</text>
    </view>
    <view class="nav-title" style="color:{{textColor}}">{{title}}</view>
    <view class="nav-right">
      <slot name="right"></slot>
    </view>
  </view>
</view>
<view style="height:{{statusBarHeight + navBarHeight}}px;"></view>
```

**WXSS:**
```css
.nav-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 999;
}
.nav-content {
  display: flex;
  align-items: center;
  padding: 0 24rpx;
}
.nav-back {
  width: 60rpx;
  height: 60rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
.back-icon { font-size: 36rpx; }
.nav-title {
  flex: 1;
  text-align: center;
  font-size: 34rpx;
  font-weight: 500;
}
.nav-right {
  width: 60rpx;
}
```

### 2. 空状态组件（empty-state）

**JS:**
```javascript
Component({
  properties: {
    icon: { type: String, value: '/assets/images/empty.png' },
    text: { type: String, value: '暂无数据' },
    buttonText: { type: String, value: '' }
  },
  methods: {
    onAction() {
      this.triggerEvent('action');
    }
  }
});
```

**WXML:**
```xml
<view class="empty-state">
  <image class="empty-icon" src="{{icon}}" mode="aspectFit" />
  <text class="empty-text">{{text}}</text>
  <view wx:if="{{buttonText}}" class="empty-btn" bindtap="onAction">
    {{buttonText}}
  </view>
</view>
```

### 3. 加载更多组件（load-more）

**JS:**
```javascript
Component({
  properties: {
    loading: { type: Boolean, value: false },
    hasMore: { type: Boolean, value: true },
    noMoreText: { type: String, value: '没有更多了' }
  }
});
```

**WXML:**
```xml
<view class="load-more">
  <view wx:if="{{loading}}" class="loading">
    <view class="spinner"></view>
    <text>加载中...</text>
  </view>
  <view wx:elif="{{!hasMore}}" class="no-more">
    <view class="line"></view>
    <text>{{noMoreText}}</text>
    <view class="line"></view>
  </view>
</view>
```

### 4. 表单组件模板

**WXML:**
```xml
<view class="form">
  <view class="form-item">
    <text class="form-label">姓名</text>
    <input
      class="form-input"
      value="{{name}}"
      bindinput="onNameInput"
      placeholder="请输入姓名"
    />
  </view>

  <view class="form-item">
    <text class="form-label">手机号</text>
    <button class="form-btn-phone" open-type="getPhoneNumber" bindgetphonenumber="onGetPhone">
      微信一键获取
    </button>
  </view>

  <view class="form-item">
    <text class="form-label">备注</text>
    <textarea
      class="form-textarea"
      value="{{remark}}"
      bindinput="onRemarkInput"
      placeholder="请输入备注"
      maxlength="200"
    />
    <text class="form-count">{{remark.length || 0}}/200</text>
  </view>

  <button class="submit-btn" bindtap="onSubmit" disabled="{{submitting}}">
    {{submitting ? '提交中...' : '提交'}}
  </button>
</view>
```

---

## 自定义组件规范

### 组件设计原则

1. **单一职责**：一个组件只做一件事
2. **接口清晰**：properties 定义输入，triggerEvent 定义输出，slot 定义插槽
3. **样式隔离**：使用 externalClasses 暴露样式钩子
4. **数据驱动**：不要在组件内直接操作父组件 data

### 组件通信方式

| 方式 | 方向 | 场景 |
|------|------|------|
| properties | 父→子 | 传递数据 |
| triggerEvent | 子→父 | 事件通知 |
| selectComponent | 父→子 | 调用子组件方法 |
| getOpenerEventChannel | 页面间 | 路由传参 |
| EventChannel | 页面间 | 双向通信 |
| globalData / Storage | 全局 | 跨页面共享 |

### 外部样式类用法

**组件 JS:**
```javascript
Component({
  externalClasses: ['custom-class', 'title-class']
});
```

**组件 WXML:**
```xml
<view class="container custom-class">
  <text class="title title-class">{{title}}</text>
</view>
```

**父页面 WXML:**
```xml
<my-component custom-class="my-container" title-class="my-title" />
```

---

## 样式编写规范

### 布局优先用 Flex

```css
/* 水平居中 */
.flex-center-h {
  display: flex;
  justify-content: center;
}

/* 垂直居中 */
.flex-center-v {
  display: flex;
  align-items: center;
}

/* 两端对齐 */
.flex-between {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

/* 等分布局 */
.flex-equal {
  display: flex;
}
.flex-equal > view {
  flex: 1;
}
```

### 尺寸用 rpx

```css
/* 设计稿 750px 宽度时，1rpx = 0.5px */
.card {
  width: 702rpx;          /* 宽度 */
  padding: 24rpx;         /* 内边距 */
  margin: 16rpx auto;     /* 外边距 */
  border-radius: 16rpx;   /* 圆角 */
  font-size: 28rpx;       /* 字号 */
}
```

### 安全区适配

```css
/* 底部安全区 */
.safe-bottom {
  padding-bottom: constant(safe-area-inset-bottom); /* iOS < 11.2 */
  padding-bottom: env(safe-area-inset-bottom);      /* iOS >= 11.2 */
}
```
