# 小程序项目结构与配置规范

## 标准目录结构

```
miniprogram/
├── app.js                    # App 入口
├── app.json                  # 全局配置
├── app.wxss                  # 全局样式
├── sitemap.json              # 搜索收录配置
├── project.config.json       # 项目配置
├── project.private.config.json  # 本地配置（不入git）
│
├── pages/                    # 主包页面
│   ├── index/
│   │   ├── index.js
│   │   ├── index.json
│   │   ├── index.wxml
│   │   └── index.wxss
│   └── ...
│
├── pagesA/                   # 分包A
│   ├── pageA1/
│   └── pageA2/
│
├── pagesB/                   # 分包B
│   ├── pageB1/
│   └── pageB2/
│
├── components/               # 公共组件
│   ├── nav-bar/
│   ├── loading/
│   └── empty-state/
│
├── utils/                    # 工具函数
│   ├── request.js            # 网络请求封装
│   ├── auth.js               # 登录态管理
│   ├── util.js               # 通用工具
│   └── constants.js          # 常量定义
│
├── services/                 # 业务服务层
│   ├── user.js
│   ├── order.js
│   └── product.js
│
├── assets/                   # 静态资源
│   ├── icons/
│   └── images/
│
├── styles/                   # 公共样式
│   ├── variables.wxss        # CSS 变量
│   ├── mixins.wxss           # 通用 mixin
│   └── reset.wxss            # 样式重置
│
└── miniprogram_npm/          # npm 构建产物
```

## app.json 完整配置模板

```json
{
  "pages": [
    "pages/index/index",
    "pages/category/category",
    "pages/cart/cart",
    "pages/mine/mine"
  ],
  "subpackages": [
    {
      "name": "pagesA",
      "root": "pagesA",
      "pages": [
        "detail/detail",
        "search/search"
      ],
      "independent": false
    },
    {
      "name": "pagesB",
      "root": "pagesB",
      "pages": [
        "order/order",
        "address/address"
      ]
    }
  ],
  "preloadRule": {
    "pages/index/index": {
      "network": "all",
      "packages": ["pagesA"]
    }
  },
  "window": {
    "navigationBarBackgroundColor": "#ffffff",
    "navigationBarTitleText": "小程序名称",
    "navigationBarTextStyle": "black",
    "backgroundColor": "#f5f5f5",
    "backgroundTextStyle": "dark",
    "enablePullDownRefresh": false
  },
  "tabBar": {
    "color": "#999999",
    "selectedColor": "#07c160",
    "backgroundColor": "#ffffff",
    "borderStyle": "black",
    "list": [
      {
        "pagePath": "pages/index/index",
        "text": "首页",
        "iconPath": "assets/icons/home.png",
        "selectedIconPath": "assets/icons/home-active.png"
      },
      {
        "pagePath": "pages/category/category",
        "text": "分类",
        "iconPath": "assets/icons/category.png",
        "selectedIconPath": "assets/icons/category-active.png"
      },
      {
        "pagePath": "pages/cart/cart",
        "text": "购物车",
        "iconPath": "assets/icons/cart.png",
        "selectedIconPath": "assets/icons/cart-active.png"
      },
      {
        "pagePath": "pages/mine/mine",
        "text": "我的",
        "iconPath": "assets/icons/mine.png",
        "selectedIconPath": "assets/icons/mine-active.png"
      }
    ]
  },
  "permission": {
    "scope.userLocation": {
      "desc": "用于获取您的位置信息，推荐附近门店"
    }
  },
  "requiredPrivateInfos": [
    "getLocation",
    "chooseLocation",
    "chooseAddress"
  ],
  "requiredBackgroundModes": ["audio"],
  "usingComponents": true,
  "sitemapLocation": "sitemap.json",
  "lazyCodeLoading": "requiredComponents",
  "style": "v2"
}
```

## 分包策略决策

| 场景 | 策略 | 说明 |
|------|------|------|
| 主包超过 1.5MB | 强制分包 | 将非首页/非tabBar页面移入分包 |
| 功能模块独立 | 独立分包 | independent: true，分包可独立加载 |
| 高频访问分包 | 分包预下载 | preloadRule 配置预下载 |
| 主包 < 2MB | 建议分包 | 预留空间，方便后续迭代 |

## sitemap.json 配置

```json
{
  "desc": "关于本文件的更多信息，请参考文档",
  "rules": [
    {
      "action": "allow",
      "page": "pages/index/index"
    },
    {
      "action": "disallow",
      "page": "*"
    }
  ]
}
```

## project.config.json 要点

```json
{
  "description": "项目配置文件",
  "packOptions": {
    "ignore": [
      { "type": "file", "value": ".eslintrc.js" },
      { "type": "folder", "value": "node_modules" }
    ]
  },
  "setting": {
    "urlCheck": true,
    "es6": true,
    "enhance": true,
    "postcss": true,
    "preloadBackgroundData": false,
    "minified": true,
    "newFeature": false,
    "coverView": true,
    "nodeModules": true,
    "autoAudits": false,
    "showShadowRootInWxmlPanel": true,
    "scopeDataCheck": false,
    "uglifyFileName": false,
    "checkInvalidKey": true,
    "checkSiteMap": true,
    "uploadWithSourceMap": true,
    "compileHotReLoad": true,
    "babelSetting": {
      "ignore": [],
      "disablePlugins": [],
      "outputPath": ""
    }
  },
  "compileType": "miniprogram",
  "appid": "wxXXXXXXXXXXXXXXXX",
  "projectname": "your-project-name",
  "condition": {}
}
```

## 全局样式建议（app.wxss）

```css
/* 全局变量 */
page {
  --color-primary: #07c160;
  --color-danger: #ee0a24;
  --color-warning: #ff976a;
  --color-text: #323233;
  --color-text-secondary: #969799;
  --color-bg: #f5f5f5;
  --font-size-sm: 24rpx;
  --font-size-base: 28rpx;
  --font-size-lg: 32rpx;
  --spacing-base: 24rpx;
  --radius-base: 8rpx;
}

/* 重置样式 */
page {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: var(--font-size-base);
  color: var(--color-text);
  background-color: var(--color-bg);
  box-sizing: border-box;
}

view, text, image {
  box-sizing: border-box;
}

/* 安全区适配 */
.safe-area-bottom {
  padding-bottom: constant(safe-area-inset-bottom);
  padding-bottom: env(safe-area-inset-bottom);
}
```
