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
| 状态 | Pinia（boardStore / chamberStore / lacquerStore / stringingStore / changeStore / historyStore） |
| 存储 | IndexedDB（Dexie，库名 `gbguqin-db`） |
| 同步 | 两台平板离线记录，导出摘要随备份保存，回坊后按琴号对账合并（无服务器） |
| 托管 | nginx:alpine（多阶段构建，SPA try_files + gzip） |

## 本地开发

```bash
cd frontend
npm install
npm run dev      # http://localhost:21810
npm run build    # 类型检查 + 生产构建
npm run test:merge  # 对账合并逻辑断言（esbuild 打包后在 node 跑，需 fake-indexeddb）
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
│       ├── types/             # wood-board / sound-chamber / lacquer-layer / stringing / changes（+ ui.ts）
│       ├── stores/            # board / chamber / lacquer / stringing / change / history
│       ├── components/common/ # DimensionChart / LayerStack / ToneTextEditor / FilterBar / StatBadge / ProcessTimeline / EmptyPanel / MergeDialog
│       ├── hooks/             # useGuqinFilter / useStageProgress
│       ├── pages/             # WorkshopBoard / BoardList / ChamberEditor / LacquerLedger / StringingLog / MergeHistory（+ NotFound）
│       ├── router/index.ts    # 路由表
│       └── utils/             # layer / db / export / merge / summary / device / stage-table（+ wood.ts / seed.ts / id.ts / plain.ts）
└── frontend/test/             # 对账计划与端到端合并断言（npm run test:merge）
```

## 功能与路由

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/` | 琴坯进度 | 选材/掏膛/灰胎/上弦四阶段统计、推进比、缺失项与工序动态 |
| `/boards` | 板材登记与配对 | 面板底板配对、含水率回显、厚度差、槽腹剖面标注 |
| `/chambers` | 槽腹尺寸记录 | 纳音/龙池/凤沼三处厚度、槽腹深度、天地柱与龙池凤沼尺寸，SVG 剖面标注 |
| `/lacquer` | 灰胎髹漆遍次 | 按遍次累加厚度、荫房温湿度窗口校验、层积条与养护天数 |
| `/stringing` | 上弦与音色评价 | 散音/按音/泛音三段纯文本评语、九德简述、缺陷标记与版本对照 |
| `/history` | 合并历史 · 后补做 | 冲突中未选内容转入历史，可整份取回采用或登记补做完成 |

## 两台平板离线对账合并

两台平板各自离线记录，回坊后不再整库恢复覆盖，而是**按琴号 × 四个工序阶段（板材/槽腹/髹漆/上弦）对账合并**：

1. **导出随阶段保存变更摘要**：每次新增/修改/删除都会在变更摘要台账（`changes` 表）留痕，记录阶段、琴号、动作、一句话摘要、整行快照、操作员、设备号与序号；「导出备份」把四表、台账、设备标识一并写入 JSON。
2. **对账规则**（顶栏「合并档案」选择对端备份）：
   - 只在一台平板改过：直接接受（对端改过就接受、仅本机改过就保留）；
   - 两台都改过同一琴的同一阶段：两边的变更摘要**并列展示**，由操作员选择继续用哪一次，支持「全部用本机/全部用对端」快捷选择；
   - 未选中的内容不会丢失：自动**转入历史**（`history` 表），在「合并历史」页可查看快照、**整份取回采用**或登记后补做完成；
   - 对端删除的共享记录会在本机同步删除；髹漆阶段合并后按遍次重算累计厚度。
3. **旧备份兼容**：没有变更摘要的旧备份按业务行差异降级对账（新增直接接受、同号不一致仍并列选择；旧备份无法还原删除动作），导入时自动识别，无需手工升级。
4. **演示样例保护**：首批示例档案带 `isDemo` 标记（v3 升级时回填）；操作员一旦改过样例即转为正式记录。任何合并/导入中，演示样例行都**不得覆盖同 id 的正式记录**，被拦截时会提示条数。
5. 每台平板首次使用自动生成设备标识（侧栏可改名）；按设备记录合并水位，重复导入同一备份不会重复对账。

## 数据存储说明

- 全部数据存于浏览器 IndexedDB（Dexie，库名 `gbguqin-db`），表：`boards`、`chambers`、`lacquers`、`stringings`、`changes`（变更摘要台账）、`history`（未选内容历史）、`meta`。
- `db.version(1)` 建表声明索引；`db.version(2)` 为髹漆表增加 `[guqinNo+seq]` 复合索引并回填历史厚度；`db.version(3)` 增加 `changes`/`history` 两表、各业务表 `isDemo` 索引并给首批演示样例补打标记。升级前可用顶栏「导出备份」导出全量 JSON。
- 首次打开且表为空时写入一批示例工序档案（`src/utils/seed.ts`，均带 `isDemo` 标记）。
- 容器无状态：不使用数据库服务、不挂载命名卷，`docker compose down` 后数据仍留在浏览器中。
