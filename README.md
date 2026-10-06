# TanPit-01 · 南冈鞣场

鞣坑场地图作业台。登录后是按行列铺开的坑位，点坑登记浸液酸碱度并改状态。

## 技术栈

| 层 | 技术 |
| --- | --- |
| Web API | Django 5 · Django Ninja（不是 DRF 视图集） |
| 结构 | Django app `pits`：models / rules / api 分文件 |
| 数据 | Django ORM · PostgreSQL 15 |
| 前端 | Lit 3 Web Component · Vite |
| 部署 | Docker Compose |

## 路径与端口

- 前端：http://localhost:4770
- API：http://localhost:8770
- PostgreSQL：localhost:6170

## 演示账号

`admin` / `123456`，`worker` / `123456`

## 业务规则

- 坑不可标「已放液」，除非最近一次浸液酸碱度在 **3.5～5.0**。规则在 `backend/pits/rules.py`。
- 管理员在**行口看板**（顶栏进入，独立专页）为每一排设置鞣制中并存上限（正整数）与行口开关。
- 开关打开且该行鞣制中坑数已达上限时，再把坑注液拨成鞣制中会被后端中文挡住；各排分别计数，互不影响。
- 关掉开关后该行不再受上限约束。登记酸碱度、标已放液不占行上限。
- 操作工打开行口看板只能查看数字，改设置返回 403。

## 快速启动

```bash
cd TanPit/TanPit-01
docker compose up --build
```
