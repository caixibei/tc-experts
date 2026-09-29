# 云开发指南

## 一、云函数

### 基础模板（CRUD）

```javascript
// cloudfunctions/dataCrud/index.js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { action, collection, data, query, id, page = 1, size = 10 } = event;
  const col = db.collection(collection);

  switch (action) {
    case 'add':
      return await col.add({ data: { ...data, createdAt: db.serverDate() } });

    case 'update':
      return await col.doc(id).update({
        data: { ...data, updatedAt: db.serverDate() }
      });

    case 'delete':
      return await col.doc(id).remove();

    case 'get':
      return await col.doc(id).get();

    case 'list':
      const count = await col.where(query || {}).count();
      const list = await col.where(query || {})
        .orderBy('createdAt', 'desc')
        .skip((page - 1) * size)
        .limit(size)
        .get();
      return { total: count.total, list: list.data, page, size };

    case 'aggregate':
      // 聚合查询示例
      return await col.aggregate()
        .match(query || {})
        .group({
          _id: '$category',
          total: _.aggregate.sum('$amount'),
          count: _.aggregate.sum(1)
        })
        .end();

    default:
      throw new Error(`未知操作: ${action}`);
  }
};
```

### 定时触发云函数

```javascript
// cloudfunctions/dailyTask/index.js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  // 每天凌晨执行
  // 示例：清理过期订单
  const now = new Date();
  const expireTime = new Date(now.getTime() - 30 * 60 * 1000); // 30分钟过期

  const { data: expiredOrders } = await db.collection('orders')
    .where({
      status: 'pending',
      createdAt: db.command.lt(expireTime)
    })
    .get();

  for (const order of expiredOrders) {
    await db.collection('orders').doc(order._id).update({
      data: { status: 'expired' }
    });
  }

  return { processed: expiredOrders.length };
};
```

**config.json（定时触发器配置）：**
```json
{
  "triggers": [
    {
      "name": "dailyTrigger",
      "type": "timer",
      "config": "0 0 2 * * * *"
    }
  ]
}
```

Cron 表达式：`秒 分 时 日 月 星期 年`
- `0 0 2 * * * *` → 每天凌晨2点
- `0 0/30 * * * * *` → 每30分钟

---

## 二、云数据库

### 集合设计原则

1. **命名规范**：小写+下划线，如 `user_orders`
2. **字段命名**：驼峰命名，如 `createTime`
3. **必备字段**：`_id`(自动生成)、`createdAt`、`updatedAt`
4. **软删除**：用 `deleted: false` 字段而非物理删除
5. **索引设计**：查询频繁的字段建立索引

### 数据模型模板

```javascript
// 用户表 users
{
  _id: "auto",
  openid: "oXXXX",
  unionid: "oYYYY",
  nickname: "用户昵称",
  avatarUrl: "https://...",
  phone: "13800138000",
  role: "user",          // user | admin
  status: "active",      // active | banned
  createdAt: Date,
  lastLoginAt: Date
}

// 订单表 orders
{
  _id: "auto",
  orderId: "ORD_xxx",
  userId: "user_id",
  openid: "oXXXX",
  items: [
    { productId: "xxx", name: "商品名", price: 9900, quantity: 1 }
  ],
  totalAmount: 9900,     // 单位：分
  status: "pending",     // pending | paid | shipped | completed | refunded
  address: { name: "张三", phone: "138...", address: "..." },
  paymentId: "pay_xxx",
  createdAt: Date,
  paidAt: Date,
  shippedAt: Date
}
```

### 常用查询模式

```javascript
const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;

// 1. 条件查询
const result = await db.collection('orders')
  .where({
    status: 'paid',
    totalAmount: _.gte(10000),
    createdAt: _.gte(new Date('2026-01-01'))
  })
  .orderBy('createdAt', 'desc')
  .limit(20)
  .get();

// 2. 或条件查询
const result2 = await db.collection('orders')
  .where(_.or([
    { status: 'pending' },
    { status: 'paid', totalAmount: _.gte(50000) }
  ]))
  .get();

// 3. 聚合查询 - 按类别统计销售额
const stats = await db.collection('orders')
  .aggregate()
  .match({ status: 'paid' })
  .unwind('$items')
  .group({
    _id: '$items.category',
    totalSales: $.sum('$items.price'),
    orderCount: $.sum(1)
  })
  .sort({ totalSales: -1 })
  .end();

// 4. 联表查询（lookup）
const ordersWithUser = await db.collection('orders')
  .aggregate()
  .lookup({
    from: 'users',
    localField: 'userId',
    foreignField: '_id',
    as: 'userInfo'
  })
  .end();
```

### 索引建议

| 集合 | 建议索引 | 查询场景 |
|------|----------|----------|
| orders | `{ openid: 1, createdAt: -1 }` | 用户查自己的订单 |
| orders | `{ status: 1, createdAt: -1 }` | 按状态筛选 |
| users | `{ openid: 1 }` (唯一) | 登录查找用户 |
| products | `{ category: 1, salesCount: -1 }` | 分类页排序 |

### 安全规则模板

```json
{
  "read": "auth.openid == doc.openid || auth.openid == 'ADMIN_OPENID'",
  "write": "auth.openid == doc.openid",
  "create": true,
  "update": "auth.openid == doc.openid",
  "delete": false
}
```

---

## 三、云存储

```javascript
// 上传文件
async function uploadFile(filePath, cloudPath) {
  const res = await wx.cloud.uploadFile({
    cloudPath,           // 云存储路径，如 'images/2026/09/xxx.jpg'
    filePath             // 本地文件路径
  });
  return res.fileID;     // 返回 fileID
}

// 下载文件
async function downloadFile(fileID) {
  const res = await wx.cloud.downloadFile({ fileID });
  return res.tempFilePath;
}

// 删除文件
async function deleteFiles(fileList) {
  const res = await wx.cloud.deleteFile({ fileList });
  return res.fileList;
}

// 获取临时链接
async function getTempURL(fileID) {
  const res = await cloud.openapi.cloud.getTempFileURL({
    fileList: [fileID]
  });
  return res.fileList[0].tempFileURL;
}
```

---

## 四、云调用

```javascript
// 云函数中调用微信开放接口
const cloud = require('wx-server-sdk');

// 发送订阅消息
await cloud.openapi.subscribeMessage.send({
  touser: openid,
  templateId: 'TEMPLATE_ID',
  data: {
    thing1: { value: '订单已发货' },
    thing2: { value: '顺丰速运 SF1234567890' },
    time3: { value: '2026-09-15 14:00' }
  },
  page: 'pages/order/detail?id=123'
});

// 生成小程序码
await cloud.openapi.wxacode.get({
  path: 'pages/index/index?scene=123',
  width: 430
});

// 获取手机号（新版动态令牌方式）
await cloud.callFunction({
  name: 'getPhoneNumber',
  data: { code: '动态令牌' }
});
```

---

## 五、最佳实践

1. **云函数超时**：默认3秒，长时间任务设置 `timeout` 并配合异步回调
2. **数据库限制**：单次查询最多返回100条，超过需分页
3. **并发写入**：使用事务避免并发更新冲突
4. **文件上传**：大文件分片上传，图片先压缩再上传
5. **安全规则**：永远不要设为 `true`（完全开放），按角色控制权限
6. **环境变量**：不同环境（开发/测试/生产）使用不同 envId
