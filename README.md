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

坑不可标「已放液」，除非最近一次浸液酸碱度在 **3.5～5.0**。规则在 `backend/pits/rules.py`。

顶栏两个页面：**坑位场地图**（点坑开抽屉登记酸碱、拨状态）与**行口看板**（独立专页）。

行口看板按行列出每行「鞣制中」并存上限（正整数）、开关、已用数；已用数 = 该行正处于鞣制中的坑数，按行分开计数、互不影响。只有管理员能改数字与开关，操作工打开看板只能看。开关打开且该行已用满上限时，再把该行坑拨成「鞣制中」会被中文挡住；关掉开关即恢复可拨。登酸碱、标已放液不吃行上限。拨状态在事务里对行口上限加行锁，两人同时抢拨不会双双放行。

## 快速启动

```bash
cd TanPit/TanPit-01
docker compose up --build
```
