# Schematic Draft

Windows 本地离线运行的电路原理图编辑器。基于开源项目
[Analog Canvas](https://github.com/cascode-ai/analog-canvas)（cascode-ai，AGPL-3.0）改造：
去掉了所有联网功能，电路数据只存在这台电脑上。

## 目录内容

| 路径                                                   | 说明                                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `Schematic Draft\schematic-draft.exe`                  | 直接双击运行，推荐日常使用；整个 `Schematic Draft\` 文件夹就是完整的一份安装 |
| `release\schematic-draft-<版本>-win-x64.zip`           | 压缩包：解压出来就是上面那个 `Schematic Draft\` 文件夹，要拿给别人就给这个   |
| `release\schematic-draft-<版本>-win-x64-setup.exe`     | 安装包：可以自己选安装目录，建开始菜单和桌面快捷方式，按当前用户装、不要管理员 |
| `source\`                                              | 完整源码（不含 node_modules），可自行审计和重新构建                          |

两种形式是同一个程序，挑一种用就行：压缩包解压出来就能跑，整个文件夹搬到别的盘、别的电脑
也还是能跑；安装包给你快捷方式和"应用和功能"里的条目。两份同时放着也没问题，但它们各自
带自己的 `Projects\`，数据不共用。

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
那是几个当前用户的注册表项，只能写在注册表里，在 `Help` 菜单里可以随时取消（见下）：

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
  - **关窗口时有没保存的改动会先问**：`X`、`Alt+F4`、`File → Exit` 都一样，弹一个
    Windows 原生对话框，三个按钮 —— `Save` 存好再关（没有文件的会先问位置），
    `Don't Save` 丢掉这次的改动直接关，`Cancel` 什么都不做。存盘被取消或者失败时窗口不会关，
    东西还在编辑器里；
  - 文件是纯 JSON，可以直接备份、拷贝、用 Git 管理；
  - 存到 `Projects\` 之外也完全可以，对话框去哪儿都行 —— 只是那样迁移就得自己再拷一份。
- **导出的 SVG/PDF/PNG/netlist**：另存为对话框默认也从 `Projects\` 开始。
- **窗口大小、界面偏好、崩溃恢复副本**：`AppData\`。崩溃恢复副本是保险，不是备份 ——
  硬盘上那个 `.schdraft` 才是正本。有副本可用时 `File` 菜单里会多出 `Recover Local Work…`。
- 菜单 `File → Open Projects Folder` 直接打开 `Projects\`；`Help → About` 显示当前实际使用的路径。
- 移动文件夹以后第一次启动，"上次打开的文件"路径失效，程序会提示一次并停在空工程上，
  重新 `Open Project…` 打开新位置的文件即可。
- 压缩包解压出来的那份和安装包装出来的那份是各自独立的安装，`Projects\` 和 `AppData\`
  都在自己的文件夹里，不共用。
- 如果把程序放在没有写权限的位置（`C:\Program Files`、只读共享盘），程序写不进自己的文件夹，
  会退回到 `%APPDATA%\Schematic Draft\` 和 `文档\Schematic Draft\`；`Help → About` 会照实显示。

（菜单栏默认隐藏，按一下 `Alt` 键显示。）

## 双击打开

`Schematic Draft\schematic-draft.exe` 第一次启动时会把 `.schdraft` 关联到自己，
这样在资源管理器里双击工程文件就直接用本程序打开：

- 写的只是**当前用户**名下两个键（`HKCU\Software\Classes\.schdraft` 和
  `HKCU\Software\Classes\SchematicDraft.Project`，后者下面放图标、打开命令，
  以及一个记着"这份程序在哪"的值），不需要管理员权限，不影响这台电脑上的其他账户；
- 打开命令里写的是**这个文件夹里**的 exe，所以文件夹移动以后再启动一次就自动指向新位置；
- 旧版本关联的是 `.icproj`；关联新后缀时会把那个键**交还**（同样只在它还指向本程序时才删），
  不会两个后缀都占着。已经存成 `.icproj` 的文件用 `File → Open Project…` 照样打开；
- `Help → Open .schdraft Files With This Copy` 是个勾选项，显示当前真实状态，
  取消勾选就把上面那两个键删掉（后缀那一个只在它还指向本程序时才删，
  别的程序后来抢走了就不动它）。取消的选择记在 `AppData\file-association.json` 里，
  下次启动不会偷偷改回去；
- 没有关联也一样能用：程序内 `File → Open Project…`，或者在资源管理器里右键
  `打开方式 → 选择其他应用`，或者命令行 `schematic-draft.exe "D:\...\amp.schdraft"`。
- 程序已经开着的时候再双击一个工程，会在**已经开着的窗口**里打开它，不会再启动一份；
  当前工程有未保存的改动时会先问一下，和 `Open Project…` 完全一样。
- `Help → About` 会照实写明当前是否关联。

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
SPICE 与 Spectre 导入/导出、SVG/PDF/PNG 导出、公式排版、撤销/恢复、崩溃恢复。

改掉：Cloud Projects → 真正的文件打开/保存（`Save` 原地覆盖，只有 `Save As…` 弹窗）。

去掉：Gallery 浏览与发布、账号登录与审核、AI Agent 与 MCP、在线仿真、
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

桌面外壳在 `apps/desktop/`（窗口、菜单、原生对话框、文件桥、断网拦截、打包），
文件打开/保存在 `apps/editor/src/features/editor-shell/`。这是一次正式分叉，不再合并上游更新：
联网功能是删掉的，不是关掉的。

## 许可

本程序是 Analog Canvas 的修改版本，遵循 GNU AGPL-3.0。`Schematic Draft\resources\` 下附带
`LICENSE.md` 与 `NOTICE.md`。自用无任何限制；若再分发，须连同源码一起并保留许可声明。
应用图标为本构建原创。
