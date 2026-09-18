# Schematic Draft

Windows 本地离线运行的电路原理图编辑器。基于开源项目
[Analog Canvas](https://github.com/cascode-ai/analog-canvas)（cascode-ai，AGPL-3.0）改造：
去掉了所有联网功能，电路数据只存在这台电脑上。

## 目录内容

| 路径                                                    | 说明                                                                       |
| ------------------------------------------------------- | -------------------------------------------------------------------------- |
| `Schematic Draft\schematic-draft.exe`                   | 直接双击运行，推荐日常使用；整个 `Schematic Draft\` 文件夹就是完整的一份安装 |
| `portable\Schematic Draft-0.9.2-win-x64-portable.exe`   | 单文件便携版，功能相同；每次启动会先解压到临时目录，启动稍慢                |
| `source\`                                               | 完整源码（不含 node_modules），可自行审计和重新构建                        |

首次运行如果 Windows SmartScreen 提示"未知发布者"，点"更多信息 → 仍要运行"即可，
程序没有做代码签名。

## 数据放在哪里

程序写的所有东西都在它自己的文件夹里，**整个文件夹复制或移动到别的盘、别的电脑就是迁移**，
不会在 `%APPDATA%`、注册表或者"文档"里留下任何东西：

```
Schematic Draft\
  schematic-draft.exe
  Projects\              ← 默认保存的工程（.icproj.json）
  AppData\               ← 窗口大小、界面偏好、崩溃恢复副本
  resources\ …           ← 程序自身的文件
```

- **电路工程**：就是你自己选的那个 `.icproj.json` 文件。
  - `File → Open Project…` / `Save As…` 走 Windows 原生对话框，默认从 `Projects\` 开始；
  - `File → Save`（`Ctrl+S`）直接覆盖当前打开的那个文件，不再弹窗；菜单里会显示要写入的完整路径；
  - 新建的工程还没有文件，第一次 `Save` 会问一次位置，之后就记住了；
  - 文件是纯 JSON，可以直接备份、拷贝、用 Git 管理；
  - 存到 `Projects\` 之外也完全可以，对话框去哪儿都行 —— 只是那样迁移就得自己再拷一份。
- **导出的 SVG/PDF/PNG/netlist**：另存为对话框默认也从 `Projects\` 开始。
- **窗口大小、界面偏好、崩溃恢复副本**：`AppData\`。崩溃恢复副本是保险，不是备份 ——
  硬盘上那个 `.icproj.json` 才是正本。有副本可用时 `File` 菜单里会多出 `Recover Local Work…`。
- 菜单 `File → Open Projects Folder` 直接打开 `Projects\`；`Help → About` 显示当前实际使用的路径。
- 移动文件夹以后第一次启动，"上次打开的文件"路径失效，程序会提示一次并停在空工程上，
  重新 `Open Project…` 打开新位置的文件即可。
- 便携版（`portable\`）同样把 `Projects\` 和 `AppData\` 建在 **它自己所在的文件夹**里，
  所以它单独放一个文件夹；它和 `Schematic Draft\` 里的那份是两套数据，不共用。
- 如果把程序放在没有写权限的位置（`C:\Program Files`、只读共享盘），程序写不进自己的文件夹，
  会退回到 `%APPDATA%\Schematic Draft\` 和 `文档\Schematic Draft\`；`Help → About` 会照实显示。

（菜单栏默认隐藏，按一下 `Alt` 键显示。）

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
cd apps/desktop && ./node_modules/.bin/electron-builder --win portable --x64 --publish never
```

NSIS 安装包（`--win nsis`）在 Linux 上需要 Wine，因此这里只产出便携版和解压版；
在 Windows 上装好 Node/pnpm 后直接运行同样的命令即可得到安装包。

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
