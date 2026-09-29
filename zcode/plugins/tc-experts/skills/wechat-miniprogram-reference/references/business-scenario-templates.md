# 业务场景模板

## 一、电商小程序

### 核心页面清单

```
首页（推荐/分类/搜索）
├── 分类页（一级分类→二级分类→商品列表）
├── 商品详情页（轮播图/价格/规格/评价/推荐）
├── 购物车页（商品列表/数量/总价/结算）
├── 订单确认页（地址/优惠券/支付方式/备注）
├── 支付结果页（成功/失败/继续购物）
├── 订单列表页（全部/待付款/待发货/待收货/已完成）
├── 个人中心（订单入口/收货地址/优惠券/客服）
└── 搜索结果页（搜索框/历史/热门/结果列表）
```

### 核心数据模型

```javascript
// 商品 products
{
  _id: "auto",
  name: "商品名称",
  categoryId: "category_id",
  images: ["url1", "url2"],
  price: 9900,           // 单位：分
  originalPrice: 12900,
  stock: 100,
  salesCount: 0,
  specs: [
    { name: "颜色", values: ["红色", "蓝色"] },
    { name: "尺码", values: ["S", "M", "L"] }
  ],
  description: "商品描述(富文本)",
  status: "on_sale",     // on_sale | off_sale
  tags: ["新品", "热销"],
  createdAt: Date,
  updatedAt: Date
}

// 购物车 cart
{
  _id: "auto",
  userId: "user_id",
  items: [
    {
      productId: "product_id",
      specId: "spec_combo_id",
      name: "商品名",
      image: "url",
      price: 9900,
      quantity: 2,
      selected: true
    }
  ],
  updatedAt: Date
}

// 收货地址 addresses
{
  _id: "auto",
  userId: "user_id",
  name: "张三",
  phone: "13800138000",
  province: "广东省",
  city: "深圳市",
  district: "南山区",
  detail: "xx路xx号",
  isDefault: true,
  createdAt: Date
}
```

### 关键功能模块

| 模块 | 核心功能 | 技术要点 |
|------|----------|----------|
| 商品 | 列表/详情/搜索/分类 | 分页加载、SKU选择器、图片预览 |
| 购物车 | 增删改查/全选/结算 | 本地+云端同步、价格计算 |
| 订单 | 下单/支付/状态流转 | 库存锁定、支付回调、超时取消 |
| 物流 | 物流查询/签收通知 | 快递100API / 快递鸟 |
| 营销 | 优惠券/满减/秒杀 | 优惠券核销、活动倒计时 |
| 用户 | 收藏/浏览记录/评价 | 收藏列表、商品评价 |

---

## 二、预约小程序

### 核心页面

```
首页（服务列表/门店选择）
├── 服务详情页（服务介绍/价格/时长/评价）
├── 预约页（日期选择/时段选择/技师选择）
├── 确认预约页（信息确认/支付/取消政策）
├── 预约记录（待确认/待服务/已完成/已取消）
├── 预约详情页（预约信息/到店导航/取消预约）
└── 个人中心
```

### 核心数据模型

```javascript
// 预约 bookings
{
  _id: "auto",
  bookingNo: "BK_xxx",
  userId: "user_id",
  serviceId: "service_id",
  serviceName: "服务名称",
  storeId: "store_id",
  storeName: "门店名称",
  staffId: "staff_id",       // 技师/顾问
  date: "2026-09-15",
  timeSlot: "14:00",
  duration: 60,              // 分钟
  price: 29900,
  status: "pending",         // pending|confirmed|in_service|completed|cancelled
  remark: "用户备注",
  createdAt: Date,
  cancelledAt: Date
}

// 时段配置 time_slots
{
  _id: "auto",
  storeId: "store_id",
  staffId: "staff_id",
  date: "2026-09-15",
  slots: [
    { time: "09:00", status: "available", maxCount: 1, booked: 0 },
    { time: "10:00", status: "available", maxCount: 1, booked: 1 },
    { time: "14:00", status: "available", maxCount: 1, booked: 0 }
  ]
}
```

### 关键交互

- **日期选择器**：横向滚动，展示未来7-14天，标记可预约/已满
- **时段选择**：网格布局，灰色=不可选，绿色=可选，用户选中高亮
- **冲突检测**：提交前查询时段是否已被预约
- **取消政策**：明确展示取消规则（如：服务前2小时可取消）

---

## 三、社区/论坛小程序

### 核心页面

```
首页（Feed流/推荐/关注）
├── 发帖页（文字/图片/视频/话题标签）
├── 帖子详情页（内容/评论/点赞/分享）
├── 话题/标签页（话题列表/话题下的帖子）
├── 个人中心（我的帖子/收藏/关注/粉丝）
├── 消息中心（评论回复/系统通知/点赞）
└── 搜索页
```

### 核心数据模型

```javascript
// 帖子 posts
{
  _id: "auto",
  userId: "user_id",
  nickname: "用户昵称",
  avatarUrl: "头像URL",
  content: "帖子内容",
  images: ["url1", "url2"],
  videoUrl: "",
  topics: ["话题1", "话题2"],
  likeCount: 0,
  commentCount: 0,
  shareCount: 0,
  isLiked: false,         // 当前用户是否点赞
  status: "published",    // published | hidden | deleted
  createdAt: Date
}

// 评论 comments
{
  _id: "auto",
  postId: "post_id",
  userId: "user_id",
  nickname: "评论者",
  content: "评论内容",
  parentId: "",            // 空=一级评论，否则=回复某评论
  replyToUserId: "",       // 回复某人
  likeCount: 0,
  createdAt: Date
}
```

### 关键功能

| 功能 | 技术要点 |
|------|----------|
| Feed流 | 分页加载、下拉刷新、无限滚动 |
| 发帖 | 图片上传+压缩、内容安全检测、草稿保存 |
| 点赞 | 乐观更新（先改UI后请求）、防重复点击 |
| 评论 | 嵌套评论展示、@某人、楼层回复 |
| 举报 | 举报入口、举报记录、管理员审核 |
| 敏感内容 | 接入微信 msgSecCheck API 过滤 |

---

## 四、工具类小程序

### 典型页面结构

```
首页（工具入口/常用工具推荐）
├── 工具页（输入→处理→输出）
├── 历史记录（上次使用的结果）
├── 设置页
└── 关于/反馈
```

### 常见工具类场景

| 工具类型 | 核心功能 | 技术要点 |
|----------|----------|----------|
| 计算器 | 输入计算/结果显示 | 纯前端计算、精度处理 |
| 图片处理 | 裁剪/压缩/加水印 | Canvas API、图片压缩 |
| 二维码 | 生成/识别 | wx.createQRCode、wx.scanCode |
| 文件处理 | PDF转换/文件压缩 | 云函数处理（wxa-api 不支持大文件） |
| 记账 | 收支记录/统计/预算 | 本地存储+云同步、图表展示 |
| 倒计时 | 目标倒计时/番茄钟 | setInterval、后台运行限制 |
| 记账/打卡 | 每日打卡/习惯养成 | 日历组件、提醒通知 |

### 关键体验设计

1. **即用即走**：首页直达核心功能，不要让用户找
2. **本地优先**：简单计算本地完成，减少网络请求
3. **结果可分享**：生成结果支持分享图片或小程序
4. **历史记录**：保存上次使用的结果，方便回顾
5. **无干扰**：尽量减少广告和弹窗

---

## 五、通用架构建议

### 目录结构建议

```
pages/           → 主包页面
services/        → 业务逻辑层（调用API、处理数据）
models/          → 数据模型定义
components/      → 公共组件
utils/           → 工具函数
constants/       → 常量定义
styles/          → 公共样式
assets/          → 静态资源
```

### 数据层设计

```javascript
// services/base.js - 基础服务封装
class BaseService {
  constructor(collection) {
    this.db = wx.cloud.database();
    this.col = this.db.collection(collection);
    this._ = this.db.command;
  }

  async add(data) {
    return await this.col.add({
      data: { ...data, createdAt: this.db.serverDate() }
    });
  }

  async getById(id) {
    return await this.col.doc(id).get();
  }

  async update(id, data) {
    return await this.col.doc(id).update({
      data: { ...data, updatedAt: this.db.serverDate() }
    });
  }

  async list(query = {}, page = 1, size = 10) {
    const countRes = await this.col.where(query).count();
    const listRes = await this.col.where(query)
      .orderBy('createdAt', 'desc')
      .skip((page - 1) * size)
      .limit(size)
      .get();
    return { total: countRes.total, list: listRes.data };
  }
}

// services/product.js - 商品服务
class ProductService extends BaseService {
  constructor() { super('products'); }

  async getByCategory(categoryId, page = 1) {
    return await this.list({ categoryId, status: 'on_sale' }, page);
  }

  async search(keyword, page = 1) {
    return await this.list({
      name: this._.regexp({ regexp: keyword, options: 'i' })
    }, page);
  }
}
```
