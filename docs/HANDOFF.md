# HANDOFF —— 跨会话交接日志

> **这是两个会话之间的"共享上下文"通道。** 独立 Claude 会话之间没有实时共享记忆，唯一可靠的桥是仓库里的文件。
> **协议**：每个里程碑开工前，先读 `docs/PLAN.md`（总规范）+ 本文件最新一节；完成后在本文件追加一节"完成记录 / 坑 / 给下一步的话"。这样谁接手都不丢信息、不走偏。

---

## M1 review（2026-07-08，游戏库侧审阅）

**结论：通过。** `@10s/schema` 与游戏库对齐良好，可作为编辑器/后端的共享契约。

已核对一致：
- `levelDef.ts` 与游戏 `assets/scripts/level/LevelDef.ts` **字段逐一吻合**（含 `door.w/h` 必填、复数数组、`minEngineVersion?`、`comingSoon?`）。
- `grid.ts` 常量 = 游戏 `Grid.ts`（`COLS50/ROWS26/CELL25.6/ORIGIN -640,-360`）；`GROUND_DROP_ROWS=1.5 / TIER2_RISE_ROWS=4.7` = 游戏 `PhysicsConstants` 的 `GROUND_DROP=CELL*1.5 / TIER2_RISE=CELL*4.7`。`surfaceRowForTier` 的 tier→row 推导 = `World.ts` 的 `surfaceY/tier2Y`。
- `playtest.ts` 消息串 `10s.playtest`/`10s.playtestResult` = 游戏 `PlaytestBridge.ts` 的 `IN_TYPE/OUT_TYPE`；`10s.sandboxReady` 已预留（游戏侧握手待 M3 再加）。
- `validate.ts` 忠实移植 app.js 承载/区间数学，纯函数、headless；`isLevelDefShape` 与游戏 `PlaytestBridge.isValidDraft` 逐字段一致；范围纪律正确（不含 solver）。

**带入后续的小 nit（非阻塞）：**
1. `RIG_COLORS` 第 3 色 `#ED4DB7` 是新增（游戏现只用青/橙两色，功能上任意色都能渲染）。第 3 组 rig 真要用时，确认配色是否符合美术方向（暗靛/紫家族，忌 off-brand）。
2. `validateLevel` 的"左下控件区"用了 `col < 8` 且仅 tier===1 的经验值；M3 内嵌真机试玩时，对照游戏 `TouchControls` 实际控件覆盖范围校准这个阈值。
3. `materializeGround/Tier2` 是"就地改 def"的编辑器辅助（已注明 in place），与"纯函数"表述略有出入——编辑器用没问题，知悉即可。
4. `overlap` 仅检测与 box/stone 的重叠（沿用 app.js），未做通用道具互叠检测；够用，若需更严后续再加。

---

## → M2 交接：`packages/editor`（移植生成器前端 + 接 @10s/schema）

**目标**：把旧生成器的 Canvas 作图 UI 搬进 `packages/editor`，改为依赖 `@10s/schema`、**去掉"写回 LevelDef.ts"**、贴图走可配置托管端点、以静态站（Vite）跑起来。**M2 只到"能作图 + 校验 + 本地草稿"**；试玩内嵌是 M3、导出/投稿是 M4。

### 移植源（只读参考）
- 旧生成器：`/Users/yangyang/Documents/10SecsLaterGenerate/public/{app.js,index.html,styles.css}`（vanilla JS，含完整 Canvas 作图/地形/校验/rig 配色）。
- 契约与工具：`@10s/schema`（本仓库 `packages/schema`）——**类型、`validateLevel`、`grid` 常量、`snapHalf/clamp`、`RIG_COLORS`、`MAX_RIGS`、`surfaceRowForTier` 等都从这里 import，别再抄一份**。
- 游戏库（只读）：`/Users/yangyang/cocos-games/10SecsLater`（如需再核对语义）。

### 必做步骤
1. **脚手架**：`packages/editor` 用 **Vite**（dev server + 静态构建）；TS（`app.js`→`app.ts`，边移边加类型）；workspace 依赖 `@10s/schema`。
2. **去重：删掉 app.js 自带的副本逻辑，改 import schema**：
   - app.js 里的 `hasSupport/supportFromTerrain/findPlacementSupport/surfaceRowForTier/surfaceIntervals/carveIntervals/mergeIntervals/pitSpan/materializeGround/materializeTier2/groundTiles/tier2Tiles` → 全部换成 `@10s/schema` 的同名导出。
   - `snapHalf/clamp/CELL/COLS/ROWS` → 用 schema 的。
   - rig 配色：用 schema `RIG_COLORS` + `MAX_RIGS`（**注意：旧 app.js 把 rig 上限写死 2，schema 是 3，以 schema 为准**）。
   - app.js 的 `TOOLS` 调色板表：保留 UI 表（label/sprite/arrayKey/singleton/terrain 等），但**占位尺寸/承载判定以 schema 为准**，别和 schema 的 `KIND_SIZE` 各写一份。
3. **移除服务端写回**：删掉所有 `fetch('/api/level/create' | '/api/level/delete' | '/api/levels/<const>' | '/api/project')`。公开编辑器**不写 LevelDef.ts**。替换为：
   - **本地草稿**：new/open/clone/save 走内存 + `localStorage`（版本键如 `10s.editor.drafts.v1`）。
   - 原来 `/api/project` 提供的"关卡列表"→ 改为"本地草稿列表 + 可载入的 `examples/*.json`"。起始可以是空白关卡或载入一个示例。
4. **贴图走 config**：app.js 的 `img.src='/sprites/<name>.png'` → `${CONFIG.SPRITE_BASE_URL}/<name>.png`。新增 `src/config.ts`（`SPRITE_BASE_URL / SANDBOX_URL / API_BASE_URL`，用 Vite `import.meta.env` 注入，见 PLAN §7）。**仓库不放任何 PNG**；本地开发把 `SPRITE_BASE_URL` 指到能取图的托管端点（例如旧生成器在跑时的 `/sprites`，或部署好的美术端点）。
5. **校验 UI**：用 `validateLevel(def)` 的返回（`{ref,reason,code}[]`）在画布上**红框高亮对应 `ref`** + 列出 `reason`。schema 已把逻辑给全，这里只做展示。
6. **坐标系**：保留 app.js 的 Canvas 像素渲染（`canvasPoint/yFromRow/rectFor`），但吸附/语义用 schema；确保画布↔cell 往返后存回的是合法 `LevelDef`。

### 不做（留给后面）
- 试玩内嵌（M3）：`playtestEmbed.ts` + iframe 沙箱 + postMessage（`@10s/schema` 的 `PLAYTEST_IN/RESULT`）。**M2 先把消息常量 import 好备用，但不接 iframe。**
- 导出 / 投稿（M4）。

### 验收（M2）
- `pnpm dev` 起编辑器；能放置/移动/删除道具，贴图从 `SPRITE_BASE_URL` 加载。
- 悬空 / 缺 spawn|key|door / 超界 / rig>3 → 红框 + 原因（走 `validateLevel`）。
- 草稿存 `localStorage`，刷新还在；**全程无任何 `/api/*` 写 LevelDef.ts**。
- 编辑器**只从 `@10s/schema` 取承载/校验/常量**（无重复实现）；`pnpm -r typecheck && pnpm -r build` 绿。

### 给下一步的话
- 保持 `packages/schema` 为唯一契约源；若 M2 发现 schema 缺东西（例如某个 UI 需要的常量），**加进 schema 再 import**，别在 editor 里另立一份。
- M2 完成后在本文件追加"M2 完成记录"，注明：实际用的 Vite 结构、config 注入方式、本地 sprites 端点怎么起，方便 M3 直接接。

---

## M2 完成记录（2026-07-08）

**结论：完成。** `packages/editor`（`@10s/editor`）跑起来了：能作图 + 校验 + 本地草稿，全程不写 `LevelDef.ts`，承载/校验/常量全部来自 `@10s/schema`。`pnpm -r typecheck && pnpm -r build` 绿；Vite dev/build 均通过。

### 结构（Vite + TS）
- `packages/editor/`：`index.html`（Vite 入口，`<script type=module src=/src/main.ts>`）、`vite.config.ts`（dev/preview 端口 5180）、`tsconfig.json`（extends 根 base，`types:["vite/client"]`、`noUncheckedIndexedAccess:false`、`noEmit`）。
- `src/main.ts` → `import './styles.css'; initEditor()`。
- `src/config.ts`：`CONFIG.{SPRITE_BASE_URL,SANDBOX_URL,API_BASE_URL}`，全走 `import.meta.env.VITE_*`（`src/env.d.ts` 声明类型）。
- `src/drafts.ts`：localStorage 草稿库（键 `10s.editor.drafts.v1`）+ `makeDefaultLevel()`（空白即合法：隐式满地板、无 rig）。
- `src/editor.ts`：从旧 `app.js` 移植的 Canvas 渲染/放置/inspector/校验 UI；**所有承载/校验/几何/常量从 `@10s/schema` import**（`findPlacementSupport/placementOverlapsStackBlocker/surfaceRowForTier/groundTiles/tier2Tiles/materialize*/pitSpan/overlaps/validateLevel/KIND_SIZE/RIG_COLORS/MAX_RIGS/THEMES/DOOR_GLOW/snapHalf/clamp/COLS…`）。editor 内**零**承载数学重写。
- `src/playtestEmbed.ts`：**M3 stub**——已 import 冻结常量 `PLAYTEST_IN/RESULT/SANDBOX_READY`，未挂 iframe。

### 为 M2 给 schema 补的导出（已 review 一致，非另立一份）
- `validate.ts` 新增 `export`：`overlaps / intervalCovers / pitSpan / carveIntervals / mergeIntervals / supportFromTerrain / KIND_SIZE`，并把私有 overlap 检测提升为公有 `placementOverlapsStackBlocker(def,kind,col,bottomRow,w,h,movingId?)`（编辑器 hover 与 `validateLevel` 共用同一实现）。
- `levelDef.ts` 新增 `export const THEMES`（8 套调色板，镜像游戏 THEME）+ `export const DOOR_GLOW`。schema 5 个单测仍绿，游戏 7 关 cross-check 仍全 clean。

### 去服务端 / 数据源
- 删掉旧前端全部 `fetch('/api/*')`（create/delete/levels/project）。关卡列表 → **本地草稿列表**（新建空白 / 克隆 / 删除），改动即 autosave 到 localStorage，刷新还在。
- **未接 `examples/*.json` 载入**（`examples/` 还没内容，属 M5）。当前起始为一个空白草稿。M5 建好 `examples/` 后，在草稿区加"载入示例"即可（editor 已具备 `LevelDoc` 载入路径，喂 JSON 即可）。

### 贴图端点（本地起法）
- `CONFIG.SPRITE_BASE_URL` 默认 `/sprites`；Vite dev 下无该路由 → 贴图 `onerror` **降级为占位框 + 名字**（画布与工具栏都做了），编辑器照常可用。
- 要看真贴图：`VITE_SPRITE_BASE_URL=http://127.0.0.1:5179/sprites pnpm --filter @10s/editor dev`（旧生成器在跑时它的 `/sprites` 现取游戏美术），或指向部署好的美术 CDN。

### 验收对照（PLAN §11 / 本节验收）
- ✅ `pnpm --filter @10s/editor dev` 起站；放置/移动/删除道具；贴图走 `SPRITE_BASE_URL`（缺则占位框）。
- ✅ 悬空 / 缺 spawn|key|door / 超界 / rig>3 → 红框高亮对应 `ref` + 列 `reason`（全走 `validateLevel`）。
- ✅ 草稿存 localStorage、刷新还在；`grep -rn "/api/" packages/editor/src` 为空。
- ✅ editor 只从 `@10s/schema` 取承载/校验/常量（无重复实现）；`pnpm -r typecheck && pnpm -r build` 绿；无 PNG 入库。
- ⚠️ 未做浏览器内交互回归（headless）；逻辑为忠实移植 + 全量 typecheck + schema 已 cross-check 承载数学。

### 给 M3 的话
- 试玩内嵌从 `src/playtestEmbed.ts` 接：挂 `<iframe src={CONFIG.SANDBOX_URL}>`，`postMessage({type:PLAYTEST_IN, def})`，监听 `PLAYTEST_RESULT`。**建议先做 §5b-B 就绪握手**——需要你在游戏私有库给 `PlaytestBridge.init()` 加 `postMessage({type:'10s.sandboxReady'})`（schema 侧 `SANDBOX_READY` 常量已就位）。
- 校验里的"左下控件区 `col<8`"阈值，M3 真机内嵌时对照游戏 `TouchControls` 覆盖范围校准（见 M1 review nit 2）。
