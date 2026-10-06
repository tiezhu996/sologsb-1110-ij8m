# 古琴斫制工序记录台（gbguqin）

面向斫琴师与琴坊档案员：把面板底板材、槽腹尺寸、灰胎髹漆遍次与上弦记录串成可回溯的工序档案；音色评价只用文字填写，不做音频文件与波形处理。纯前端单页应用，数据全部保存在浏览器本地，不依赖任何后端服务或外部接口。

## Docker 一键启动

```bash
cp .env.example .env
docker compose up -d --build
```

启动后访问：<http://localhost:21810>

停止并清理：

```bash
docker compose down
```

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | Vue 3 + TypeScript（`<script setup>`） |
| 构建 | Vite 6（`npm run build` 含 `vue-tsc --noEmit` 类型检查） |
| UI | Element Plus 2 |
| 路由 | Vue Router 4（6 条业务路由 + 404） |
| 状态 | Pinia（boardStore / chamberStore / lacquerStore / stringingStore / mergeStore） |
| 存储 | IndexedDB（Dexie，库名 `gbguqin-db`） |
| 托管 | nginx:alpine（多阶段构建，SPA try_files + gzip） |

## 本地开发

```bash
cd frontend
npm install
npm run dev      # http://localhost:21810
npm run build    # 类型检查 + 生产构建
```

## 目录结构

```
.
├── docker-compose.yml         # 顶层 name / COMPOSE_PROJECT_NAME 容器名 / 端口映射
├── .env.example               # COMPOSE_PROJECT_NAME、FRONTEND_PORT
├── frontend/
│   ├── Dockerfile             # node:20-alpine 构建 → nginx:alpine 托管
│   ├── nginx.conf             # try_files SPA 回退 + gzip
│   ├── public/favicon.svg
│   └── src/
│       ├── types/             # wood-board / sound-chamber / lacquer-layer / stringing / sync（+ ui.ts）
│       ├── stores/            # boardStore / chamberStore / lacquerStore / stringingStore / mergeStore
│       ├── components/common/ # DimensionChart / LayerStack / ToneTextEditor / FilterBar / StatBadge / ProcessTimeline / EmptyPanel
│       ├── hooks/             # useGuqinFilter / useStageProgress
│       ├── pages/             # WorkshopBoard / BoardList / ChamberEditor / LacquerLedger / StringingLog / MergeCenter（+ NotFound）
│       ├── router/index.ts    # 路由表
│       └── utils/             # layer.ts / db.ts / export.ts / sync.ts / merge.ts（+ wood.ts / seed.ts / id.ts）
```

## 功能与路由

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/` | 琴坯进度 | 选材/掏膛/灰胎/上弦四阶段统计、推进比、缺失项与工序动态 |
| `/boards` | 板材登记与配对 | 面板底板配对、含水率回显、厚度差、槽腹剖面标注 |
| `/chambers` | 槽腹尺寸记录 | 纳音/龙池/凤沼三处厚度、槽腹深度、天地柱与龙池凤沼尺寸，SVG 剖面标注 |
| `/lacquer` | 灰胎髹漆遍次 | 按遍次累加厚度、荫房温湿度窗口校验、层积条与养护天数 |
| `/stringing` | 上弦与音色评价 | 散音/按音/泛音三段纯文本评语、九德简述、缺陷标记与版本对照 |
| `/merge` | 两台平板回坊对账合并 | 按琴号对账四工序、变更摘要并列冲突选择、未选内容转历史后补 |

## 两台平板回坊对账合并

两台平板离线各自记录，回坊后**不要用整库恢复**（会覆盖另一台刚改的板材、槽腹、髹漆与上弦），统一走顶栏「回坊合并」：

1. 两台平板各自点「导出备份」。导出 JSON 随板材/槽腹/髹漆/上弦四个工序阶段保存**变更摘要流水**（`changes`）、设备号（`deviceId`）与修订号（`rev`），历次修改都保留。
2. 在其中一台上打开「回坊合并」，选择另一台导出的 JSON，系统按琴号对账（板材=琴号+部位，髹漆=琴号+遍次，槽腹/上弦=琴号）：
   - 不同阶段的修改各自保留，互不影响；
   - 同一阶段只有一边改过 → 直接接受改动的一边；
   - 两边都改过（同修订号、内容不同）→ 并列展示两边摘要与字段对照，由操作员选择继续用哪次；
   - 操作员未选的一边**转入历史**，在「未选内容后补做」页查看两版对照并标记补做完成。
3. 兼容旧备份：v1/v2 导出的 JSON 没有摘要与修订号，导入与对账时自动按「旧版记录（无变更摘要）、rev=1」归一化，不会报错。
4. 演示样例保护：内置示例（`board-001` 等 id 或带 `demo` 标记）永远不能通过合并改写正式记录；未改动的样例遇到对端正式记录时则让正式记录接管。
5. 「整库恢复」仍保留在合并页底部，作为换机/故障的高危入口，需二次确认。

## 数据存储说明

- 全部数据存于浏览器 IndexedDB（Dexie，库名 `gbguqin-db`），表：`boards`、`chambers`、`lacquers`、`stringings`、`changes`（变更摘要流水）、`mergeHistory`（未选内容后补历史）、`meta`。
- `db.version(1)` 建表声明索引；`db.version(2).upgrade(...)` 为髹漆表增加 `[guqinNo+seq]` 复合索引并回填历史厚度；`db.version(3).upgrade(...)` 增加 `changes` / `mergeHistory` 两表，为旧记录回填 `rev`/`updatedAt`/`summary` 并把内置示例标记为 `demo`。升级前可用顶栏「导出备份」导出全量 JSON。
- 首次打开且表为空时写入一批示例工序档案（`src/utils/seed.ts`，全部带 `demo: true`）。
- 容器无状态：不使用数据库服务、不挂载命名卷，`docker compose down` 后数据仍留在浏览器中。
- 合并逻辑与旧备份兼容的端到端断言见 `frontend/scripts/test-merge.mts`（`npx tsx scripts/test-merge.mts`，依赖 `fake-indexeddb`）。
