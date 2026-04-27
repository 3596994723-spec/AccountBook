# 📒 个人记账本 PWA

> 移动端优先的离线记账应用，支持 Excel 导入导出，添加到手机主屏幕即可像 App 一样使用。

[![Gitee](https://img.shields.io/badge/Gitee-huang--rutong-red?logo=gitee)](https://gitee.com/huang-rutong/account-book)
[![HTML](https://img.shields.io/badge/HTML-96.9%25-orange)](https://gitee.com/huang-rutong/account-book)
[![PWA](https://img.shields.io/badge/PWA-离线可用-blue)](https://gitee.com/huang-rutong/account-book)

## ✨ 功能特性

- 📱 **移动端优先** — FAB 悬浮按钮快速记账，卡片式账单列表
- 💾 **离线可用** — Service Worker 缓存，断网也能正常记账
- 📊 **可视化报表** — Chart.js 月度收支柱状图 + 分类饼图
- 📥 **Excel 导入** — 支持导入个人记账本 Excel 历史数据（SheetJS）
- 📤 **Excel 导出** — 一键导出为标准 Excel 文件，方便备份和迁移
- 🗂️ **分类管理** — 餐饮、交通、购物、娱乐等多种收支分类
- 🔍 **月份筛选** — 快速查看任意月份的收支明细

## 📸 预览

| 主界面 | 记账弹窗 | 数据报表 |
|-------|---------|---------|
| 卡片列表 + 月度统计 | FAB 快速记账 | 柱状图 + 饼图 |

## 🚀 快速开始

### 在线使用

访问 Gitee Pages 部署地址（开启后更新）：

```
https://huang-rutong.gitee.io/account-book/
```

### 本地运行

无需安装，直接在浏览器打开：

```bash
git clone https://gitee.com/huang-rutong/account-book.git
cd account-book
# 直接打开 index.html 即可
```

### 添加到手机主屏幕（变成 App）

1. 手机浏览器打开部署地址
2. 点击浏览器菜单 → **"添加到主屏幕"**
3. 之后从主屏幕图标打开，全屏无浏览器栏，支持离线使用

## 📁 项目结构

```
account-book/
├── index.html      # 主应用（单文件 PWA）
├── sw.js           # Service Worker（离线缓存）
├── manifest.json   # PWA 清单文件（图标、主题色等）
└── .gitignore      # Git 忽略规则
```

## 🛠️ 技术栈

| 技术 | 用途 |
|------|------|
| HTML5 / CSS3 / Vanilla JS | 核心框架，零依赖 |
| Service Worker | 离线缓存 |
| localStorage | 本地数据存储 |
| [SheetJS (xlsx)](https://sheetjs.com/) | Excel 导入导出（CDN） |
| [Chart.js](https://www.chartjs.org/) | 数据可视化（CDN） |
| Web App Manifest | PWA 安装能力 |

## 📊 Excel 导入格式

导入时支持以下列格式（列名可灵活匹配）：

| 列名 | 说明 | 示例 |
|------|------|------|
| 日期 | 记账日期 | 2026-04-01 |
| 金额 | 正数收入，负数支出 | -35.5 |
| 分类 | 消费分类 | 餐饮 |
| 备注 | 可选说明 | 午饭 |

## 🗺️ 开发计划

- [x] 基础记账（增删查）
- [x] 月份筛选
- [x] Excel 导入导出
- [x] Chart.js 可视化报表
- [x] PWA 离线支持
- [ ] IndexedDB 升级（更大容量、索引查询）
- [ ] 多账本支持
- [ ] 预算提醒

## 📄 License

MIT License — 自由使用和修改

---

> 作者：黄汝彤 · Gitee [@huang-rutong](https://gitee.com/huang-rutong)
