#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DOTNET="${DOTNET:-/root/.dotnet/dotnet}"
PY_VERSION="3.12.10"
CACHE="$ROOT/runtime/windows-tools-cache"
STAGE="$ROOT/runtime/windows-bridge-next"
ZIP="$ROOT/runtime/TeleOpc-WechatBridge-win-x64.zip"
mkdir -p "$CACHE" "$STAGE"
rm -rf "$STAGE"/*
"$DOTNET" publish "$ROOT/clients/TeleOpc.WechatBridge/TeleOpc.WechatBridge.csproj" -c Release -r win-x64 --self-contained true -o "$STAGE"
mkdir -p "$STAGE/tools/python/Lib/site-packages" "$STAGE/tools/wechat-cli"
PY_ZIP="$CACHE/python-${PY_VERSION}-embed-amd64.zip"
[[ -f "$PY_ZIP" ]] || curl -fL "https://www.python.org/ftp/python/${PY_VERSION}/python-${PY_VERSION}-embed-amd64.zip" -o "$PY_ZIP"
python3 - "$PY_ZIP" "$STAGE/tools/python" <<'PY'
import sys,zipfile,pathlib
src,out=sys.argv[1:]
with zipfile.ZipFile(src) as z:z.extractall(out)
pth=next(pathlib.Path(out).glob('python*._pth'))
pth.write_text('python312.zip\n.\n..\\wechat-cli\nLib\\site-packages\nimport site\n')
PY
WHEELS="$CACHE/wheels-cp312-win_amd64"
mkdir -p "$WHEELS"
python3 - "$WHEELS" <<'PY'
import json,sys,urllib.request,pathlib
out=pathlib.Path(sys.argv[1])
wanted={
  'click':('8.1.8',lambda n:n.endswith('py3-none-any.whl')),
  'colorama':('0.4.6',lambda n:n.endswith('py2.py3-none-any.whl')),
  'pycryptodome':('3.23.0',lambda n:'abi3-win_amd64.whl' in n),
  'zstandard':('0.23.0',lambda n:'cp312-cp312-win_amd64.whl' in n),
}
for package,(version,match) in wanted.items():
    meta=json.load(urllib.request.urlopen(f'https://pypi.org/pypi/{package}/{version}/json'))
    item=next(x for x in meta['urls'] if match(x['filename']))
    target=out/item['filename']
    if not target.exists(): urllib.request.urlretrieve(item['url'],target)
PY
python3 - "$WHEELS" "$STAGE/tools/python/Lib/site-packages" <<'PY'
import sys,zipfile,pathlib
wheels,out=map(pathlib.Path,sys.argv[1:])
for wheel in wheels.glob('*.whl'):
    with zipfile.ZipFile(wheel) as z:z.extractall(out)
PY
cp -R "$ROOT/clients/TeleOpc.WechatBridge/third_party/wechat-cli/wechat_cli" "$STAGE/tools/wechat-cli/"
cp "$ROOT/clients/TeleOpc.WechatBridge/third_party/wechat-cli/LICENSE" "$STAGE/tools/wechat-cli/LICENSE"
cp "$ROOT/clients/TeleOpc.WechatBridge/third_party/wechat-cli/NOTICE.tele-opc.txt" "$STAGE/tools/wechat-cli/NOTICE.tele-opc.txt"
if [[ -f "$ROOT/runtime/windows-bridge/bridge-config.json" ]]; then cp "$ROOT/runtime/windows-bridge/bridge-config.json" "$STAGE/bridge-config.json"; fi
cat > "$STAGE/使用说明.txt" <<'TXT'
Tele-OPC 个人微信桥接（Windows 10/11 x64）

1. 完全退出旧版桥接程序，包括右下角托盘。
2. 保持 Windows 微信已登录。
3. 运行 TeleOpc.WechatBridge.exe。
4. 直接点击“启动”。微信 4.1 会自动使用后台截图 + Windows 本地 OCR，不需要提取数据库密钥。
5. 第一次启动只建立会话基线，不处理启动前已有的旧未读消息。
6. 初次验收请保持“自动回复”关闭；确认接收正常后再开启。
7. “尝试数据库读取”仅为旧版微信兼容选项，失败也不影响屏幕识别模式。

工作方式：
- 优先监听微信右下角新消息弹窗，并以轻量会话列表变化扫描兜底。
- 微信 4.1 默认使用后台截图 + Windows 本地 OCR；截图只在本机临时处理，不上传。
- 回复前使用 Windows 本地 OCR 识别聊天标题，匹配联系人后才发送。
- OCR 不需要任何 Token，也不调用第三方 OCR 服务。
- 无法确认联系人时会阻止发送，并在客户端和服务器任务中记录错误。
- 群聊默认关闭；已知是自己发送的消息不会再次上传。

本地敏感数据目录：
%LOCALAPPDATA%\TeleOpc\WechatBridge\local-reader

如需彻底移除本地读取权限，退出客户端后删除上述 local-reader 文件夹。
TXT
python3 - "$STAGE" "$ZIP" <<'PY'
import sys,pathlib,zipfile
stage,out=map(pathlib.Path,sys.argv[1:])
if out.exists():out.unlink()
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for p in sorted(stage.rglob('*')):
        if p.is_file():z.write(p,p.relative_to(stage))
PY
sha256sum "$ZIP"
