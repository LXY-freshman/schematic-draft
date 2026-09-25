# Schematic Draft

Windows 本地离线运行的电路原理图编辑器。基于开源项目
[Analog Canvas](https://github.com/cascode-ai/analog-canvas)（cascode-ai，AGPL-3.0）改造：
去掉了所有联网功能，电路数据只存在这台电脑上。

当前版本和每一版改了什么，看
[Releases](https://github.com/LXY-freshman/schematic-draft/releases)（每个版本一页说明，
中英文都有）或者源码里的
[CHANGELOG.md](https://github.com/LXY-freshman/schematic-draft/blob/main/CHANGELOG.md)。
程序里 `Help` 的 About 一节显示装的是哪个版本。

## 目录内容

| 路径                                                   | 说明                                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `Schematic Draft\schematic-draft.exe`                  | 直接双击运行，推荐日常使用；整个 `Schematic Draft\` 文件夹就是完整的一份安装 |
| `release\schematic-draft-<版本>-win-x64.zip`           | 压缩包：解压出来就是上面那个 `Schematic Draft\` 文件夹，要拿给别人就给这个   |
| `release\schematic-draft-<版本>-win-x64-setup.exe`     | 安装包：可以自己选安装目录，建开始菜单和桌面快捷方式，按当前用户装、不要管理员 |
| `source\`                                              | 完整源码（不含 node_modules），可自行审计和重新构建                          |

两种形式是同一个程序，挑一种用就行：压缩包解压出来就能跑，整个文件夹搬到别的盘、别的电脑
也还是能跑；安装包给你快捷方式和"应用和功能"里的条目。两份同时放着也没问题，但它们各自
带自己的 `Projects\`，数据不共用。`release\` 里历次版本都留着不删，
要最新的就挑版本号最大的那一对。

首次运行如果 Windows SmartScreen 提示"未知发布者"，点"更多信息 → 仍要运行"即可，
程序没有做代码签名。

## 安装与卸载

安装包按**当前用户**安装，不需要管理员权限：

- 默认装到 `%LOCALAPPDATA%\Programs\schematic-draft`，安装时可以改成任何位置。
  装在哪里，下面说的 `Projects\` 和 `AppData\` 就在哪里 —— 想让工程待在 D 盘，
  安装时就把目录选成 `D:\Schematic Draft` 之类。
- **卸载会保留你的工程。** `Projects\` 在程序文件夹里面，卸载只删程序，那个文件夹原样留下，
  卸载完会弹一次窗告诉你路径；确实不要了，自己把整个文件夹删掉。
- 用新版本覆盖安装时，`AppData\`（窗口大小、界面偏好、崩溃恢复副本）也一起保留，
  升级不会顺手把它们清掉；只有真正卸载才删 `AppData\`，那里面几乎全是 Chromium 缓存。
- 卸载还会把 `.schdraft` 的注册表关联交还，同样只在它还指向**被卸载的这一份**程序时才删 ——
  另一个文件夹里的副本、或者后来被别的程序抢走的关联，都不动。
- 也可以在安装时选"所有用户"装到 `C:\Program Files`（要管理员），但那里程序写不进自己的文件夹，
  会走下面说的退回规则，就不再是"一个文件夹搬走就是迁移"了。

## 数据放在哪里

程序写的所有东西都在它自己的文件夹里，**整个文件夹复制或移动到别的盘、别的电脑就是迁移**，
不会在 `%APPDATA%` 或者"文档"里留下东西。唯一的例外是双击打开要用的文件关联 ——
那是几个当前用户的注册表项，只能写在注册表里，在 `Help` 的 About 一节里可以随时取消（见下）：

```
Schematic Draft\
  schematic-draft.exe
  Projects\              ← 默认保存的工程（.schdraft）
  AppData\               ← 窗口大小、界面偏好、崩溃恢复副本
  resources\ …           ← 程序自身的文件
```

- **电路工程**：就是你自己选的那个 `.schdraft` 文件（内容还是纯 JSON，只是换了个
  只属于本程序的后缀，这样才能双击打开 —— Windows 只认最后一级后缀，`.icproj.json`
  在它眼里就是 `.json`）。后缀故意起得长、带着程序名，免得别的工具也独立想到同一个
  四字母缩写把双击抢走。以前存的 `.icproj`、`.icproj.json` 和普通 `.json` 照样能打开。
  - `File → Open Project…` / `Save As…` 走 Windows 原生对话框，默认从 `Projects\` 开始；
  - `File → Save`（`Ctrl+S`）直接覆盖当前打开的那个文件，不再弹窗；菜单里会显示要写入的完整路径；
  - 新建的工程还没有文件，第一次 `Save` 会问一次位置，之后就记住了；
  - **标题栏写着正在编辑哪个文件**：`amplifier.schdraft — Schematic Draft`，有没保存的改动时
    文件名后面多一个 `*`。还没存成文件的新工程显示工程名。任务栏、`Alt+Tab` 和窗口列表里
    看到的也是这个，所以开着好几个窗口时不用挨个点进去认；
  - **关窗口时有没保存的改动会先问**：`X`、`Alt+F4`，以及 Windows 注销或关机，都一样，
    弹一个 Windows 原生对话框，三个按钮 —— `Save` 存好再关（没有文件的会先问位置），
    `Don't Save` 丢掉这次的改动直接关，`Cancel` 什么都不做。存盘被取消或者失败时窗口不会关，
    东西还在编辑器里；
  - 文件是纯 JSON，可以直接备份、拷贝、用 Git 管理；
  - 存到 `Projects\` 之外也完全可以，对话框去哪儿都行 —— 只是那样迁移就得自己再拷一份；
  - 旁边还有一个 `Check and Save`：存盘之前先跑一遍 ERC 和画法检查，把发现的问题列在
    Issues 里、同时在画布上标出来。检查结果不拦着你存；改过图之后上一次的结论就作废，
    但不会自动重跑 —— 想看新的，再点一次。
- **导入进来的文件**：`File → Import SPICE / SCS…`（以及 Cadence 那一项）和
  `File → Open a Copy…` 弹的是和 `Open Project…` 同一种对话框 —— 有标题、默认从
  `Projects\` 开始、过滤器写着本程序认得的后缀。SPICE 那两项可以一次多选，因为入口文件
  和它 `.include` 的那些文件要一起交进来。`Open a Copy…` 打开的工程**不绑定文件**：
  内容进了编辑器，但第一次 `Save` 仍会问位置，原文件不会被覆盖 —— 拿来验一份别人给的
  工程正合适。
- **导出的 SVG/PDF/PNG/Visio/netlist**：另存为对话框默认也从 `Projects\` 开始。
  网表在 `Netlist → Save netlist to file…`，按侧栏里选的格式写出 `.spi` 或 `.scs`；
  Netlist 按钮本身仍然是点一下就复制到剪贴板，两个出口给的是同一份字节。
  `File → Export drawing → Visio` 导出的 `.vsdx` 是拿去改的，不是拿去看的：每个器件是
  一个带引脚、参考号和参数的 Visio 形状；每根导线是一串线段 —— 每段直线一个形状，每个
  跨线弧也是一个 —— 段与段之间用看不见的小节点粘住，所以导线转的每个折点都有一个能直接
  拖的手柄，拖节点时两侧的线段一起走。跨线弧是独立形状，可以单独选中、移动或删掉（删掉
  之后交叉处留一个缺口，要拉拢自己拉）。在 Visio 里拖器件，线端跟着走；线本身保持你画的
  走法，Visio 不会自作主张重排。代价有两个，都是故意的：选中整根导线要框选或者按住
  `Ctrl` 点几下，文件也比以前大。导线自己调的线宽会带过去；元件的线宽和颜色带不过去 ——
  同一个符号的所有实例在 Visio 里共用一个 master，导出完的状态行会把丢掉这两样的元件
  点名写出来。旁边的 `Visio stencil` 导出的是纯符号库（`.vssx`），不含图纸。两种文件都是
  单向的，读不回来，硬盘上那个 `.schdraft` 才是正本。
- **窗口大小、界面偏好、崩溃恢复副本**：`AppData\`。崩溃恢复副本是保险，不是备份 ——
  硬盘上那个 `.schdraft` 才是正本。有副本可用时 `File` 菜单里会多出 `Recover Local Work…`。
- `File → Open Projects Folder` 直接打开 `Projects\`；`Help` 里的 About 一节显示当前
  实际使用的两个路径，以及双击关联开着没有。
- 移动文件夹以后第一次启动，"上次打开的文件"路径失效，程序会提示一次并停在空工程上，
  重新 `Open Project…` 打开新位置的文件即可。
- 压缩包解压出来的那份和安装包装出来的那份是各自独立的安装，`Projects\` 和 `AppData\`
  都在自己的文件夹里，不共用。
- 如果把程序放在没有写权限的位置（`C:\Program Files`、只读共享盘），程序写不进自己的文件夹，
  会退回到 `%APPDATA%\Schematic Draft\` 和 `文档\Schematic Draft\`；About 一节会照实显示。

**这个程序只有一套菜单，就是窗口里那一条。**没有系统菜单栏，按 `Alt` 也不会弹出来 ——
从前那条菜单栏里一个真正的命令都没有，只有三样主进程才知道的事，现在都在 `File` 菜单和
`Help` 的 About 一节里。窗口本身的几个键照旧：`Ctrl +` / `Ctrl -` / `Ctrl 0` 缩放整个界面，
`F11` 全屏，`Ctrl+Shift+I` 开发者工具。

## 器件库

左侧 Library 按"伸手去拿的顺序"排，不是按分类学排：

- **Transistors**：NMOS、PMOS、NPN、PNP，旁边是耗尽型 MOS（DNMOS / DPMOS）、两个
  DMOS，以及三个功率开关 —— E-GaN、D-GaN 和 IGBT。GaN HEMT 画成 D/G/S 三端、没有衬底
  引线，因为 GaN 器件没有体二极管，符号不装作有；IGBT 是 MOS 栅极加双极输出，引脚是
  C/G/E。这几个器件是在 Extended Devices 目录里写下的，但拿它们的时候想的是"找个管子"，
  所以就摆在管子这一节。
- **Power and Ports**：Ground（SPICE 节点 `0`）、AGND、DGND，以及 VDD 电源标记。模拟地
  画实心三角、数字地画空心三角，三个地一眼分得开；AGND 和 DGND 是普通的全局网络，一路
  带到网表里，混合信号设计需要的就是这个。
- 其余是 Passives、Sources、Switches、Analog Blocks、Logic Gates、Signal Flow、标注图元，
  以及 Extended Devices —— 没有参考书测量依据的器件都留在那一节，并且如实说明。

工具栏上 `Library` 旁边那个 `Gallery` 是**随程序带的五个示例电路**（共源放大器、电流镜负载
差分对、两级运放、全差分两级运放、五管 OTA），点开就能载进来照着看，全在本地；在线版那个
能浏览和投稿的图库是删掉的，两者只是名字撞了。

**GaN HEMT 和 IGBT 没有标准 SPICE 卡片。** 没有哪一种标准语法描述它们，所以网表导出
不会把它们打扮成 MOSFET 再配上硅器件的模型参数，而是照实报告这个实例出不了网表。把它
绑到你自己导入的 `.subckt` 上，它就按普通子电路调用打印，背后用的是厂商自己的模型。

## 画法与外观

选中任何对象（或者按 `Q`）打开 Properties，那是个表单，不是一坨 JSON。`Appearance` 一节
管画法，改的只是画法，器件和连接关系都不动：

- **颜色**：色板用的是 MATLAB 默认配色顺序（中性浅灰，然后蓝、橙、黄、紫、绿、青、深红），
  这样导线和它画出来的那条曲线可以配成同一个颜色，不用拿十六进制去对；`RGB` 可以自己填，
  0–255 或者十六进制都认。
- **`Stroke width ×`**：导线和元件都能单独调粗细，0.25 到 4 倍，每次四分之一档。想让电源
  轨看起来像根轨、或者让正在讨论的那个器件在打印稿上跳出来，用这个。粗的导线不多带电流，
  粗的符号还是同一个器件、同样的引脚。
- **`Bulk terminal`**（只有 MOS 有）：勾上就画出衬底引线，三端符号变成四端画法。B 在两种
  画法里都是真引脚，所以网表、引脚顺序、已经接在衬底上的导线全都不动；变的只是导线落点，
  因为衬底引线从沟道侧面出来，不是从符号背面。
- **`Hop over crossings`**（只有导线有）：这根线跨过它交叉的线时画一个弧，而不是十字压过去。

文档级还有六个系数，在属性面板里那一节 **Style** 下面 —— 那是一段可以直接改、也可以整段
复制的 JSON，点哪一行都会给出可选值：**Font size**（图纸上所有文字）、**Wire thickness**、
**Symbol thickness**、**Drawing thickness**（矩形、箭头、标注笔画）、**Junction dot size**
（连接点圆点半径）、**Line jump size**（跨线弧半径）。每个都是相对当前配置的 0.5×–2×，
1× 就是原样。这六个值、MOS 衬底的默认网络、以及格点和滚轮这些画布偏好，一起就是那段
**Style** 代码，复制到下一个文档里粘上就行 —— 不用一项项再调一遍。跨线弧调大之后两侧
需要更长的直线段，所以在大尺寸下靠近折点的那个交叉会画成平的而不是画歪，这一直是决定
"这个弧放不放得下"的规则。

状态栏上的格点按钮三档循环 **Grid Off → Grid On → Grid On · Coarse**，粗格点在同样的细点上
把每第七个点画大画深，画布读起来就是"七个小格一个大格"，距离不用数点。选中一根导线、或者
一个网络标签时，旁边会出现 `Highlight Net (H)`，把整条网络点亮；它和 `Hop over crossings`
一样，是按下去就保持按下的按钮，亮着蓝框就是开着，不会改名字让你去猜当前是什么状态。
格点和网络高亮都只在屏幕上，存盘和导出都不带。

## 双击打开

`Schematic Draft\schematic-draft.exe` 第一次启动时会把 `.schdraft` 关联到自己，
这样在资源管理器里双击工程文件就直接用本程序打开：

- 写的只是**当前用户**名下两个键（`HKCU\Software\Classes\.schdraft` 和
  `HKCU\Software\Classes\SchematicDraft.Project`，后者下面放图标、打开命令，
  以及一个记着"这份程序在哪"的值），不需要管理员权限，不影响这台电脑上的其他账户；
- 打开命令里写的是**这个文件夹里**的 exe，所以文件夹移动以后再启动一次就自动指向新位置；
- 旧版本关联的是 `.icproj`；关联新后缀时会把那个键**交还**（同样只在它还指向本程序时才删），
  不会两个后缀都占着。已经存成 `.icproj` 的文件用 `File → Open Project…` 照样打开；
- `Help` 的 About 一节里有个勾选项 `Open .schdraft files with this copy`，显示当前真实状态，
  取消勾选就把上面那两个键删掉（后缀那一个只在它还指向本程序时才删，
  别的程序后来抢走了就不动它）；改动完还会弹一个原生对话框说明发生了什么，因为动的是注册表。
  取消的选择记在 `AppData\file-association.json` 里，下次启动不会偷偷改回去；
- 没有关联也一样能用：程序内 `File → Open Project…`，或者在资源管理器里右键
  `打开方式 → 选择其他应用`，或者命令行 `schematic-draft.exe "D:\...\amp.schdraft"`。
- 程序已经开着的时候再双击一个工程，会在**已经开着的窗口**里打开它，不会再启动一份；
  当前工程有未保存的改动时会先问一下，和 `Open Project…` 完全一样。
- `Help` 的 About 一节会照实写明当前是否关联。

## 安全保证

1. **没有任何网络请求**。编辑器从程序自带的文件加载，主进程在 Chromium 发起连接前就拦截并拒绝所有
   `http/https/ws` 请求，即使将来某个版本的编辑器代码试图联网也会失败。
2. **不开本地端口**。编辑器通过程序内部的 `app://` 协议加载，而不是本机 HTTP 服务，其他进程无法访问工程接口。
3. **无账号、无云同步、无遥测**。上游的"Cloud Projects"整套代码被真正的文件打开/保存替代，
   Gallery、登录、审核、发布、使用统计、Agent API 与 MCP 服务、在线仿真的代码都是删掉的，
   不是藏起来的 —— 没有开关能打开，也没有代码路径能连出去。
4. **渲染进程沙箱化**，`contextIsolation` 开启，没有 Node 集成；导出文件走系统"另存为"对话框。
5. 剪贴板以外的浏览器权限请求（摄像头、定位、通知等）一律拒绝。

## 与在线版的差异

保留：原理图编辑、层次化设计（Cell / Cell Pin / 导入 Cell）、符号库、
SPICE 与 Spectre 导入/导出、SVG/PDF/PNG 与 Visio 导出、公式排版、撤销/恢复、崩溃恢复。

改掉：Cloud Projects → 真正的文件打开/保存（`Save` 原地覆盖，只有 `Save As…` 弹窗）；
属性面板从一坨可编辑的 JSON 变成表单，每一项有名字、有取值范围、有说明（文档那一节
`Style` 仍然是代码形式，因为它的用处恰好是整段复制）。

分叉以后本地加的（在线版没有这些）：`.schdraft` 双击关联、窗口标题写着正在编辑哪个文件、
关窗口前问未保存的改动、`Check and Save`、网表直接写成文件、Visio 导出成可继续编辑的
链式导线（每个折点一个手柄、跨线弧独立成形状）与 `.vssx` 符号库、导线与元件各自的颜色和
线宽倍数、MOS 的三端/四端衬底画法、文档级六个系数与可复制的 `Style` 代码、跨线弧尺寸、
画布粗格点、模拟地与数字地、三个功率开关（E-GaN / D-GaN / IGBT）。

去掉：Gallery 的在线浏览与投稿（工具栏上那个 `Gallery` 按钮现在是本地自带的示例电路）、
账号登录与审核、AI Agent 与 MCP、在线仿真、
时序仿真、Bug 反馈链接、使用统计、网页版的"安装到桌面"（Service Worker
离线缓存与 manifest —— 装好的程序本身就是安装，不会有缓存副本变旧的问题）。仿真本身不做了，但电路可以导出成
netlist 交给 ngspice 之类的仿真器；在线版存下来的仿真设置在这里也能正常读写、
不会丢。

## 重新构建

在 WSL（或任何 Linux/macOS）里，需要 Node ≥ 24 和 pnpm 11：

```bash
cd source
pnpm install
scripts/sync-to-windows.sh /mnt/d/AI/Claude/schematic-draft   # 全量构建并复制到这里
```

重新构建只替换程序本身：`Schematic Draft\Projects\` 和 `Schematic Draft\AppData\`
会原样保留。构建前先把程序关掉，Windows 不允许覆盖正在运行的 `.exe`。

单独的步骤：

```bash
pnpm build                                        # 工作区各包 + 编辑器前端
node apps/desktop/scripts/make-icons.mjs          # 图标
node apps/desktop/scripts/build.mjs               # 主进程打包
cd apps/desktop && ./node_modules/.bin/electron-builder --win nsis --x64 --publish never
node apps/desktop/scripts/package-zip.mjs         # 压缩包
```

安装包（`--win nsis`）在 Linux 上要装 Wine：NSIS 生成 `Uninstall.exe` 的唯一办法，
是把刚编出来的安装器跑一次，而那是个 Windows 程序。
`sudo dpkg --add-architecture i386 && sudo apt install wine wine32:i386`
（NSIS 的 stub 是 32 位的，只有 wine64 跑不起来）。没装 Wine 时
`sync-to-windows.sh` 会跳过安装包、照常产出其余内容。卸载时保留工程的那段逻辑在
`apps/desktop/build/installer.nsh`，electron-builder 按文件名自动带上。

压缩包由 `package-zip.mjs` 打，需要 `zip`（`sudo apt install zip`）。
electron-builder 自带的 `zip` 目标对 Windows 是不带顶层文件夹的，解压会把两百多个文件
铺在当前目录，所以这一步自己来。

网络不通 GitHub 时，设置镜像：
`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`、
`ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`
（`sync-to-windows.sh` 已默认设置）。

桌面外壳在 `apps/desktop/`（窗口、快捷键、原生对话框、文件桥、断网拦截、打包），
文件打开/保存在 `apps/editor/src/features/editor-shell/`。这是一次正式分叉，不再合并上游更新：
联网功能是删掉的，不是关掉的。

## 许可

本程序是 Analog Canvas 的修改版本，遵循 GNU AGPL-3.0。`Schematic Draft\resources\` 下附带
`LICENSE.md` 与 `NOTICE.md`。自用无任何限制；若再分发，须连同源码一起并保留许可声明。
应用图标为本构建原创。
