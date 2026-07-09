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

## 游戏侧 M3 协调项：`10s.sandboxReady` 握手已实现（2026-07-08，游戏库侧）

> M3（试玩内嵌）需要的游戏侧配合**已在游戏库 `assets/scripts/editor/PlaytestBridge.ts` 完成并类型检查通过**（改动尚未 commit，在游戏工作区）。M3 会话按下面契约对接即可，**无需等我**。

**游戏侧现在的行为（沙箱 = 托管的 Cocos web 构建，放进你的 `<iframe>`）：**
1. 沙箱启动（`MainMenu.start → PlaytestBridge.init`）且**被 iframe 内嵌**（`window.parent !== window`）时，向 `parent` 发：`{ type: '10s.sandboxReady' }`（targetOrigin `'*'`）。
2. 监听 `message`：收到 `{ type:'10s.playtest', def, returnScene? }` 且 `def` 合法 → 真引擎载入并试玩。
3. 通关 → 向**发消息来的那个 window**（`ev.source`，即编辑器）回 `{ type:'10s.playtestResult', won:true, steps }`。
4. 玩家点「返回编辑」但没通关 → 回 `{ type:'10s.playtestResult', won:false }`。
5. 仍兼容引导期 `?draft=<encodeURIComponent(JSON)>`（无需握手；结果回 `window.parent`）。

**M3（编辑器侧）要实现的时序：**
1. 建 `<iframe src=CONFIG.SANDBOX_URL>`（**别在 URL 里塞 draft**，走 postMessage 稳）。
2. **先挂** `window.addEventListener('message', …)`（在建 iframe 前/同时），因为沙箱启动慢、`sandboxReady` 随后才来。
3. 收到 `SANDBOX_READY`（`ev.source === iframe.contentWindow`）→ 投递草稿：`iframe.contentWindow.postMessage({ type: PLAYTEST_IN, def }, SANDBOX_ORIGIN)`。
4. 收到 `PLAYTEST_RESULT` → 关掉/隐藏 iframe；`won:true` 则**解锁"导出/投稿"**（呼应 M4）。
5. **消息串一律用 `@10s/schema` 的 `PLAYTEST_IN / PLAYTEST_RESULT / SANDBOX_READY`，别硬编码。**

**注意点：**
- 游戏侧目前 `sandboxReady`/`result` 用 `'*'` 发（MVP）。编辑器侧**要校验 `ev.origin`**；投递草稿用**明确的 `SANDBOX_ORIGIN`**（dev 可 `'*'`）。上线前两边都收紧 origin 白名单。
- `def` 需过游戏 `isValidDraft`（= schema `isLevelDefShape`，字段吻合）；投递前先跑 `validateLevel` 更稳。
- `steps` = 通关用的模拟步数（60 = 1s），后端复算防作弊时会用到。
- 兜底（可选）：若 ~8s 没等到 `sandboxReady`（极旧构建），可退回 `?draft=` 的 iframe src。

**待游戏库那边 commit 后**：`SANDBOX_URL` 指向你部署的 Cocos `web-mobile` 构建；本地联调可指向游戏工程的 web 预览。

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

---

## M3 完成记录（2026-07-08）

**结论：完成（编辑器侧）。** 试玩内嵌按游戏侧 §5b-B 握手契约接好；`pnpm -r typecheck && pnpm -r build` 绿。真机端到端联调待游戏库 commit + 部署 `SANDBOX_URL` 后进行；本地已用 mock 沙箱验证时序。

### 实现（`packages/editor/src/playtestEmbed.ts` 从 stub → 实模块）
- `openPlaytest(def, {onResult})`：建模态 overlay + `<iframe src=CONFIG.SANDBOX_URL>`（**URL 不塞 draft**）。**先挂 `message` 监听再 mount iframe**。
- 时序完全对齐游戏侧 HANDOFF：收到 `SANDBOX_READY`（校验 `ev.origin===SANDBOX_ORIGIN` 且 `ev.source===iframe.contentWindow`）→ `iframe.contentWindow.postMessage({type:PLAYTEST_IN, def}, SANDBOX_ORIGIN)`；收到 `PLAYTEST_RESULT` → 显示结果 + 回调。
- 消息串全部来自 `@10s/schema`（`PLAYTEST_IN/PLAYTEST_RESULT/SANDBOX_READY`），零硬编码（已 grep 确认打进 bundle）。
- **origin 白名单**：`SANDBOX_ORIGIN = new URL(CONFIG.SANDBOX_URL).origin`；收发都用它（dev 若同源则自然放行）。
- **兜底**：`~8s` 没等到 `sandboxReady`（极旧构建）→ 退回 `?draft=` 的 iframe src 重载（关卡过大则提示放弃，不硬发以免 listener 未就绪丢消息）。
- 关闭：`返回编辑 ✕` 按钮 / 点遮罩 / Esc；关时移除 listener + timer。

### 编辑器接线（`editor.ts` / `index.html` / `styles.css`）
- topbar 加 `#playtestButton`；**门控** = `isPlaytestConfigured()`（`SANDBOX_URL` 非空）**且** `validateLevel(level())===[]`。未配置/未通过校验时禁用并给 title 提示。
- 传给沙箱的是 `clone(level())` 快照；投递前隐含已过 `validateLevel`（= 游戏 `isValidDraft`）。
- **won 解锁**：`won:true` → 按 `draftId → 关卡 JSON 签名` 记进 `beaten` map；**任意编辑改变签名即自动重新上锁**（呼应"作者亲测通关"绑定确切 def）。inspector 显示"✓ 已在真机通关 · 可投稿（M4）"/"真机通关后解锁投稿"。按钮通关后变"重玩 ✓"。
- **导出/投稿 UI 本身属 M4**——M3 只把 `won` 解锁状态做出来供 M4 gate。

### 本地联调（mock 沙箱，gitignored）
- `.agent-contexts/m3-playtest/mock-sandbox.html`：实现同一契约（announce ready / 收 playtest / 回 result；含 `?draft=` 兜底）。用法：
  ```sh
  python3 -m http.server 5199 --directory .agent-contexts/m3-playtest
  VITE_SANDBOX_URL=http://127.0.0.1:5199/mock-sandbox.html pnpm --filter @10s/editor dev
  ```
  编辑器点「试玩」→ mock announce ready → 收到 def → 点「通关」→ 回 `won:true` → inspector 解锁徽标亮。已验证：env 注入 bundle、契约串入 bundle、mock/dev 均起站。⚠️ 未做浏览器内点击级回归（headless 限制）。

### 给游戏库 / M4 的话
- 待游戏库 commit 后：部署 Cocos `web-mobile` 构建，把 `VITE_SANDBOX_URL` 指过去即可端到端。origin 上线前两边收紧白名单（现 MVP `'*'` 发、编辑器侧已校验收方 origin）。
- `steps`（通关模拟步数，60=1s）已透传到 `onResult`，M4 投稿信封可带上供后端复算防作弊。
- M4：投稿走 `CONFIG.API_BASE_URL`；导出 `LevelEnvelope`（schema 已定，含 `author?` 占位）；**gate = `won` 解锁**（editor 已具备该状态，M4 直接读 `beaten`/加导出按钮即可）。

### M3 修正（本地真机联调反馈后）
- **握手超时太短导致关卡不一致**：旧的 8s 兜底在冷启动（引擎+wasm+资源）未加载完时就触发、退回 `?draft=` 重载 → 沙箱显示的是旧/默认关卡。修：**等握手的宽限期 8s→20s**；兜底**从"URL 重载"改为"best-effort postMessage 直投"**（投递的是精确 `def`，不再有 URL 编码/竞态导致的错关）；加了 6s "首次加载较慢" 的安抚提示。→ 正常情况下握手会先到、直接走 postMessage 投递精确关卡，试玩内容与编辑器一致。
- **UX（按用户反馈）**：试玩弹窗**去掉所有按钮**（原「返回编辑 ✕」移除）、**去掉点空白关闭**（防误触）；退出改为**键盘 Esc**（父窗口有焦点时）+ **收到 `PLAYTEST_RESULT` 自动返回编辑**（通关/返回都由游戏内键盘/操作驱动，结果一到就关弹窗，约 0.9s 展示后返回）。header 只留状态文本 + 「按 Esc 返回编辑」提示。
- 注意：跨源 iframe 获焦后，父窗口收不到其键盘事件——所以"结果自动返回"是主退出路径；Esc 作为父窗口有焦点时的补充。

---

## → 游戏侧待办：M3 真机联调的两个阻塞项（2026-07-09，编辑器侧发现）

> 本地联调发现：**编辑器侧已正确投递精确 `def`**（overlay 状态现在会显示注入的关卡名/物件数，console 也打印了 def）。但沙箱表现异常，定位到**两项都在游戏库侧**，编辑器无法处理。

**1. `build/web-mobile` 构建过期 → 注入的草稿不渲染（关卡对不上）**
- 现象：编辑器投递草稿后，沙箱显示的**不是**编辑器里的关卡，而是默认游戏；顶栏 20s 后才出现"已注入"（其实是编辑器等不到握手走了 best-effort 直投）。
- 定位：当前被 serve 的 `build/web-mobile` 是 **Jun 23 的旧构建**，`grep` 里 **完全没有** `draftLevel / isPlaytest / EditorState / sandboxReady` —— 即这个构建**根本不含试玩桥/草稿渲染**。而游戏侧试玩源码是 **Jul 8–9**（`PlaytestBridge.ts`/`EditorState.ts`），比所有 build 都新；`build/{web-mobile,wechatgame,wechatgame-001}` 无一含试玩代码。
- **待办（游戏库侧）**：用 Cocos Creator 从**当前源码重新 Build `web-mobile`**（含 PlaytestBridge + EditorState + LevelGame 试玩分支），再把这个新目录 serve/部署到 `SANDBOX_URL`。之后编辑器注入的草稿即会在真引擎里渲染、与编辑器一致。

**2. 内嵌试玩时隐藏屏上触控按钮（用户要"只键盘操作"）**
- 现象："左右 4 个操作按钮"是**游戏自己的 TouchControls HUD**（Cocos canvas 内绘制，在 iframe 里）——**编辑器无法移除**（跨源 + 非 DOM）。
- **待办（游戏库侧）**：`isPlaytest`/内嵌模式下**不建/隐藏 TouchControls**，并确保**键盘输入可用**（方向/跳跃/交互）。与已有"试玩分支跳过体力/进度/榜单/埋点"一致地加一条即可。
- 可选：给试玩消息约定一个开关（如 `{ type:PLAYTEST_IN, def, controls:'keyboard' }`）供未来细化；当前编辑器已按 keyboard-only 设计，游戏侧直接在 playtest 模式隐藏即可，无需编辑器改动。

> 结论：M3 编辑器侧已完成且正确；真机端到端**卡在游戏库需要一次"含试玩支持的 web-mobile 新构建" + playtest 模式隐藏触控**。这两步做完，用 `VITE_SANDBOX_URL` 指向新构建即可端到端一致。
