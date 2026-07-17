#!/usr/bin/env python3
"""MoboBoost/CDReader CPS scraper for Tele-OPC AppOS.

Connects to an already logged-in CloakBrowser profile through the Manager CDP
proxy, reads the MoboBoost content center, and writes AppOS-compatible JSON.
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
import subprocess

try:
    import websocket
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "websocket-client", "-q"])
    import websocket


MANAGER_URL = os.environ.get("CLOAKBROWSER_MANAGER", "http://127.0.0.1:8080").rstrip("/")
PROFILE_ID = os.environ.get("CLOAKBROWSER_PROFILE", "152a3eef-6b63-4ef1-a0cb-0c7127110ed5")
ENTRY_URL = os.environ.get("MOBOBOOST_ENTRY_URL", "https://ckoc.cdreader.com/cn/material/content/v2/center")
FALLBACK_URL = os.environ.get("MOBOBOOST_FALLBACK_URL", "https://mckoc.cdreader.com/#/home?invCode=M939405")

KNOWN_PLATFORMS = [
    "\u5168\u90e8\u5e73\u53f0",
    "MoboReels",
    "FlickReels",
    "KalosTV",
    "ShortMax",
    "HoneyReels",
    "FlexTV",
    "Footage",
    "TopShort",
]


def classify_download_failure(text):
    normalized = str(text or "")
    if any(
        keyword in normalized
        for keyword in (
            "\u8bf7\u5148\u8d26\u53f7\u62a5\u5907",
            "\u8d26\u53f7\u62a5\u5907\u540e",
            "\u62a5\u5907\u540e\u518d\u4e0b\u8f7d",
            "\u8bf7\u5148\u62a5\u5907",
            "\u8bf7\u5148\u62a5\u767d",
        )
    ):
        return ("account_report_required", "\u8d26\u53f7\u62a5\u5907")
    if any(keyword in normalized for keyword in ("\u65e0\u6743\u9650", "\u6682\u65e0\u6743\u9650", "\u6ca1\u6709\u6743\u9650", "\u6743\u9650\u4e0d\u8db3")):
        return ("permission_denied", "\u65e0\u6743\u9650")
    if any(keyword in normalized for keyword in ("\u672a\u751f\u6210\u8d44\u6e90", "\u751f\u6210\u63a8\u5e7f\u8d44\u6e90")):
        return ("resource_not_generated", "\u672a\u751f\u6210\u8d44\u6e90")
    return ("no_file_download", "\u65e0\u6587\u4ef6\u4e0b\u8f7d")


class CdpClient:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=20, suppress_origin=True)
        self.next_id = 1

    def send(self, method, params=None, timeout=20):
        msg_id = self.next_id
        self.next_id += 1
        payload = {"id": msg_id, "method": method}
        if params is not None:
            payload["params"] = params
        old_timeout = self.ws.gettimeout()
        self.ws.settimeout(timeout)
        self.ws.send(json.dumps(payload))
        try:
            while True:
                message = json.loads(self.ws.recv())
                if message.get("id") == msg_id:
                    return message
        finally:
            self.ws.settimeout(old_timeout)

    def eval(self, expression, timeout=20):
        response = self.send(
            "Runtime.evaluate",
            {"expression": expression, "returnByValue": True, "awaitPromise": True},
            timeout=timeout,
        )
        if response.get("exceptionDetails"):
            desc = response["exceptionDetails"].get("exception", {}).get("description", "")
            raise RuntimeError(desc or json.dumps(response["exceptionDetails"], ensure_ascii=False))
        result = response.get("result", {}).get("result", {})
        if "value" in result:
            return result["value"]
        return None

    def navigate(self, url, wait_seconds=6):
        self.send("Page.navigate", {"url": url}, timeout=10)
        time.sleep(wait_seconds)

    def close(self):
        self.ws.close()


def manager_json(path):
    with urllib.request.urlopen(f"{MANAGER_URL}{path}", timeout=15) as response:
        return json.loads(response.read())


def page_ws_urls():
    pages = manager_json(f"/api/profiles/{PROFILE_ID}/cdp/json/list")
    preferred = [
        candidate
        for candidate in pages
        if candidate.get("type") == "page" and "ckoc.cdreader.com" in candidate.get("url", "")
    ]
    fallback = [
        candidate
        for candidate in pages
        if candidate.get("type") == "page" and candidate not in preferred
    ]
    candidates = [*preferred, *fallback]
    if not candidates:
        raise RuntimeError(f"No browser page found for profile {PROFILE_ID}")

    urls = []
    manager_netloc = urllib.parse.urlparse(MANAGER_URL).netloc
    for page in candidates:
        raw_url = page["webSocketDebuggerUrl"]
        devtools_frontend = page.get("devtoolsFrontendUrl") or ""
        match = re.search(r"ws=([^&]+)", devtools_frontend)
        if match:
            urls.append("ws://" + urllib.parse.unquote(match.group(1)))
        if f"/api/profiles/{PROFILE_ID}/cdp/" in raw_url:
            urls.append(raw_url.replace("ws://localhost:", "ws://127.0.0.1:"))
        else:
            devtools_path = raw_url.split("/devtools/", 1)[-1]
            urls.append(f"ws://{manager_netloc}/api/profiles/{PROFILE_ID}/cdp/devtools/{devtools_path}")
            urls.append(raw_url.replace("ws://localhost:", "ws://127.0.0.1:"))
    return list(dict.fromkeys(urls))


def page_ws_url():
    return page_ws_urls()[0]


def connect():
    errors = []
    for ws_url in page_ws_urls():
        client = None
        try:
            client = CdpClient(ws_url)
            client.send("Runtime.enable", timeout=10)
            client.send("Page.enable", timeout=10)
            return client
        except Exception as exc:
            errors.append(f"{ws_url}: {exc}")
            try:
                if client:
                    client.close()
            except Exception:
                pass
    raise RuntimeError("No responsive MoboBoost CDP page: " + " | ".join(errors))


def ensure_moboboost_page(client):
    current_url = client.eval("location.href", timeout=10) or ""
    if "ckoc.cdreader.com" not in current_url and "mckoc.cdreader.com" not in current_url:
        client.navigate(ENTRY_URL)
    title = client.eval("document.title", timeout=10) or ""
    try:
        body_text = client.eval("document.body ? document.body.innerText.slice(0, 300) : ''", timeout=30) or ""
    except Exception:
        body_text = ""
    if "MoboBoost" not in title and "MoboBoost" not in body_text:
        client.navigate(FALLBACK_URL)
        try:
            body_text = client.eval("document.body ? document.body.innerText.slice(0, 300) : ''", timeout=30) or ""
        except Exception:
            body_text = ""
    if "MoboBoost" not in body_text and "MoboBoost" not in title:
        raise RuntimeError("MoboBoost page is not logged in or not loaded")


def click_platform(client, platform):
    if not platform:
        return
    script = """
(() => {
  const platform = %s;
  const wanted = String(platform || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  if (!wanted || wanted === 'all') return JSON.stringify({ok:true, skipped:true});
  const allText = ['\\u5168\\u90e8\\u5e73\\u53f0', '\\u5168\\u90e8'];
  const nodes = [
    ...Array.from(document.querySelectorAll('span.ant-tag, button, a, [role="button"]')),
    ...Array.from(document.querySelectorAll('span, div'))
  ];
  const exact = nodes.find((el) => {
    const text = String(el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    if (!text || text.length > 40) return false;
    if (allText.includes(platform)) return allText.includes(text);
    return text.toLowerCase() === wanted;
  });
  if (!exact) return JSON.stringify({ok:false, reason:'platform_not_found', platform});
  if (String(exact.className || '').includes('ant-tag-checkable-checked')) {
    return JSON.stringify({ok:true, alreadySelected:true, text:String(exact.innerText || exact.textContent || '').trim()});
  }
  exact.scrollIntoView({block:'center', inline:'center'});
  exact.click();
  return JSON.stringify({ok:true, text:String(exact.innerText || exact.textContent || '').trim()});
})()
""" % json.dumps(platform)
    result = json.loads(client.eval(script, timeout=10))
    if not result.get("ok"):
        raise RuntimeError(f"MoboBoost platform tab not found: {platform}")
    if result.get("alreadySelected"):
        return
    wanted = platform.strip().lower()
    for _ in range(12):
        selected = client.eval(
            """
(() => {
  const wanted = %s;
  const tag = Array.from(document.querySelectorAll('span.ant-tag'))
    .find((el) => String(el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase() === wanted);
  return Boolean(tag && String(tag.className || '').includes('ant-tag-checkable-checked'));
})()
"""
            % json.dumps(wanted),
            timeout=10,
        )
        if selected:
            time.sleep(4)
            return
        time.sleep(1)
    time.sleep(6)


def parse_visible_data(client):
    script = r"""
(() => {
  const knownPlatforms = __KNOWN_PLATFORMS__;
  const platformTabs = knownPlatforms.filter((name) => document.body.innerText.indexOf(name) >= 0)
    .map((name, index) => ({index, name}));
  const coverImages = Array.from(document.images)
    .filter((img) => {
      const cls = String(img.className || '');
      const parentText = String(img.parentElement && img.parentElement.innerText || '').trim();
      return img.naturalWidth >= 200
        && img.naturalHeight >= 300
        && (parentText === '\u9884\u89c8' || cls.includes('coverImg-Z'));
    })
    .map((img) => img.src);
  return JSON.stringify({platforms: platformTabs, bodyText: document.body.innerText || '', coverImages});
})()
""".replace("__KNOWN_PLATFORMS__", json.dumps(KNOWN_PLATFORMS, ensure_ascii=False))
    page_data = json.loads(client.eval(script, timeout=20))
    lines = [line.strip() for line in page_data.get("bodyText", "").splitlines() if line.strip()]
    cover_images = page_data.get("coverImages", [])
    items = parse_body_lines(lines, cover_images)
    return {"platforms": page_data.get("platforms", []), "items": items}


def safe_filename_part(value):
    text = re.sub(r"[^\w.\-\u4e00-\u9fff]+", "_", str(value or "").strip(), flags=re.UNICODE)
    return text.strip("._")[:80] or "moboboost"


def site_filename_part(value):
    text = re.sub(r'[<>:"/\\|?*\r\n\t]+', "_", str(value or "").strip(), flags=re.UNICODE)
    text = re.sub(r"\s+", " ", text, flags=re.UNICODE)
    return text.strip(" ._")[:120] or "moboboost"


def moboboost_episode_filename(item, video_type, episode):
    title = safe_filename_part(item.get("title") or item.get("enName") or item.get("chName") or "moboboost")
    suffix = "\u7b2c%s\u96c6" % episode if episode else "episode"
    kind = "origin" if video_type == "origin" else "subtitle"
    return f"{title}-{suffix}-{kind}.mp4"


def moboboost_episode_filename_candidates(item, video_type, episode, include_untyped=False):
    raw_title = item.get("title") or item.get("enName") or item.get("chName") or "moboboost"
    title = safe_filename_part(raw_title)
    site_title = site_filename_part(raw_title)
    suffix = "\u7b2c%s\u96c6" % episode if episode else "episode"
    candidates = [moboboost_episode_filename(item, video_type, episode)]
    if include_untyped:
        # Native browser downloads can briefly keep the site's default name. Only
        # use these candidates for files captured from the just-clicked download;
        # reconciliation must not infer origin/subtitle type from an untyped name.
        candidates.append(f"{title}-{suffix}.mp4")
        candidates.append(f"{site_title}-{suffix}.mp4")
    return list(dict.fromkeys(candidates))


def is_stable_download_file(path, stable_seconds=1.0):
    if not path.exists() or not path.is_file():
        return False
    if path.suffix.lower() != ".mp4":
        return False
    first_size = path.stat().st_size
    if first_size <= 0:
        return False
    time.sleep(stable_seconds)
    if not path.exists() or not path.is_file():
        return False
    return path.stat().st_size == first_size and first_size > 0


def find_completed_episode_file(download_dir, item, video_type, episode, include_untyped=False):
    for filename in moboboost_episode_filename_candidates(item, video_type, episode, include_untyped=include_untyped):
        path = download_dir / filename
        if is_stable_download_file(path):
            return path
    if not include_untyped:
        return None
    raw_title = item.get("title") or item.get("enName") or item.get("chName") or "moboboost"
    title_candidates = {safe_filename_part(raw_title), site_filename_part(raw_title)}
    episode_marker = "\u7b2c%s\u96c6" % episode
    candidates = sorted(download_dir.glob("*.mp4"), key=lambda path: path.stat().st_mtime, reverse=True)
    for path in candidates:
        if any(title in path.stem for title in title_candidates) and episode_marker in path.stem and is_stable_download_file(path):
            return path
    return None


def canonicalize_downloaded_episode_file(path, target_path):
    path = Path(path)
    target_path = Path(target_path)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        return path
    try:
        if path.resolve() == target_path.resolve():
            return target_path
    except Exception:
        pass
    if target_path.exists():
        try:
            if path.stat().st_size == target_path.stat().st_size:
                path.unlink()
        except Exception:
            pass
        return target_path
    path.replace(target_path)
    return target_path


def reconcile_expected_downloaded_files(downloaded, item, download_dir, download_types, start_episode, end_episode):
    existing_keys = {(file.get("downloadType"), file.get("episode")) for file in downloaded}
    for video_type in download_types:
        for episode_number in range(start_episode, end_episode + 1):
            if (video_type, episode_number) in existing_keys:
                continue
            expected_path = find_completed_episode_file(download_dir, item, video_type, episode_number)
            if not expected_path:
                continue
            kind_prefix = "episode_video" if video_type == "origin" else "subtitle_video"
            downloaded.append(
                {
                    "kind": f"{kind_prefix}_{episode_number}",
                    "localPath": str(expected_path),
                    "sourceUrl": "",
                    "episode": episode_number,
                    "downloadType": video_type,
                }
            )
            existing_keys.add((video_type, episode_number))
    downloaded.sort(key=lambda file: (file.get("episode") is None, file.get("episode") or 0, file.get("kind") or ""))
    return downloaded


def ensure_pywinauto():
    try:
        from pywinauto import Desktop, keyboard

        return Desktop, keyboard
    except ImportError:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pywinauto", "-q"])
        from pywinauto import Desktop, keyboard

        return Desktop, keyboard


def save_native_save_as_dialog(target_path, timeout_seconds=20):
    Desktop, keyboard = ensure_pywinauto()
    target_path = Path(target_path).resolve()
    target_path.parent.mkdir(parents=True, exist_ok=True)
    deadline = time.time() + timeout_seconds
    last_error = None
    while time.time() < deadline:
        for backend in ("uia", "win32"):
            try:
                desktop = Desktop(backend=backend)
                windows = [
                    window
                    for window in desktop.windows()
                    if "\u53e6\u5b58\u4e3a" in window.window_text() or "Save As" in window.window_text()
                ]
                if not windows:
                    continue
                dialog = windows[0]
                dialog.set_focus()
                try:
                    edits = [
                        control
                        for control in dialog.descendants(control_type="Edit")
                        if control.is_enabled() and control.is_visible()
                    ]
                    if edits:
                        edits[0].set_edit_text(str(target_path))
                    else:
                        keyboard.send_keys("^a")
                        keyboard.send_keys(str(target_path), with_spaces=True)
                except Exception:
                    keyboard.send_keys("^a")
                    keyboard.send_keys(str(target_path), with_spaces=True)

                buttons = dialog.descendants(control_type="Button")
                save_button = next(
                    (
                        button
                        for button in buttons
                        if button.window_text() in ("\u4fdd\u5b58(S)", "\u4fdd\u5b58", "&Save", "Save")
                    ),
                    None,
                )
                if save_button:
                    save_button.click_input()
                else:
                    keyboard.send_keys("{ENTER}")

                # Confirm overwrite if the native confirmation dialog appears.
                time.sleep(0.8)
                for confirm in desktop.windows():
                    title = confirm.window_text()
                    if not ("\u786e\u8ba4\u53e6\u5b58\u4e3a" in title or "\u786e\u8ba4" in title or "Confirm" in title):
                        continue
                    confirm.set_focus()
                    yes = next(
                        (
                            button
                            for button in confirm.descendants(control_type="Button")
                            if button.window_text() in ("\u662f(Y)", "\u662f", "&Yes", "Yes")
                        ),
                        None,
                    )
                    if yes:
                        yes.click_input()
                    else:
                        keyboard.send_keys("{ENTER}")
                return True
            except Exception as exc:
                last_error = exc
        time.sleep(0.5)
    if last_error:
        raise RuntimeError(f"Native Save As dialog handling failed: {last_error}")
    return False


def set_download_behavior(client, download_dir):
    download_dir = download_dir.resolve()
    download_dir.mkdir(parents=True, exist_ok=True)
    params = {"behavior": "allow", "downloadPath": str(download_dir), "eventsEnabled": True}
    # Chromium versions differ on whether Browser or Page owns download behavior.
    for method in ("Browser.setDownloadBehavior", "Page.setDownloadBehavior"):
        try:
            client.send(method, params, timeout=10)
        except Exception:
            pass


def completed_download_files(download_dir):
    if not download_dir.exists():
        return []
    files = []
    for path in download_dir.iterdir():
        if not path.is_file():
            continue
        name = path.name.lower()
        if name.endswith(".crdownload") or name.endswith(".tmp"):
            continue
        files.append(path)
    return files


def wait_for_downloads(download_dir, before_names, expected_count, timeout_seconds):
    deadline = time.time() + timeout_seconds
    stable_ticks = 0
    last_snapshot = None
    new_files = []
    while time.time() < deadline:
        completed = completed_download_files(download_dir)
        new_files = [path for path in completed if path.name not in before_names]
        partials = list(download_dir.glob("*.crdownload")) + list(download_dir.glob("*.tmp"))
        snapshot = sorted((path.name, path.stat().st_size) for path in new_files if path.exists())
        if len(new_files) >= expected_count and not partials:
            if snapshot == last_snapshot:
                stable_ticks += 1
                if stable_ticks >= 2:
                    return sorted(new_files, key=lambda path: path.name)
            else:
                stable_ticks = 0
                last_snapshot = snapshot
        time.sleep(1)
    if new_files:
        return sorted(new_files, key=lambda path: path.name)
    return []


def wait_for_browser_downloads(client, download_dir, before_names, expected_count, timeout_seconds):
    deadline = time.time() + timeout_seconds
    completed_paths = []
    old_timeout = client.ws.gettimeout()
    client.ws.settimeout(1)
    try:
        while time.time() < deadline:
            try:
                message = json.loads(client.ws.recv())
            except Exception:
                message = None
            if message and message.get("method") == "Browser.downloadProgress":
                params = message.get("params", {})
                if params.get("state") == "completed" and params.get("filePath"):
                    completed_paths.append(Path(params["filePath"]))

            completed = [path for path in completed_paths if path.exists() and path.name not in before_names]
            disk_completed = [path for path in completed_download_files(download_dir) if path.name not in before_names]
            merged = {path.name: path for path in [*completed, *disk_completed]}
            partials = list(download_dir.glob("*.crdownload")) + list(download_dir.glob("*.tmp"))
            if len(merged) >= expected_count and not partials:
                return sorted(merged.values(), key=lambda path: path.name)
    finally:
        client.ws.settimeout(old_timeout)
    disk_completed = [path for path in completed_download_files(download_dir) if path.name not in before_names]
    return sorted(disk_completed, key=lambda path: path.name)


def close_visible_modals(client):
    client.eval(
        r"""
(() => {
  for (const modal of Array.from(document.querySelectorAll('.ant-modal')).reverse()) {
    if (getComputedStyle(modal).display === 'none') continue;
    const close = modal.querySelector('button.ant-modal-close');
    if (close) close.click();
  }
  for (const close of Array.from(document.querySelectorAll('.ant-image-preview-close, [class*="image-preview-close"]')).reverse()) {
    close.click();
  }
  document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', code:'Escape', keyCode:27, which:27, bubbles:true}));
  return true;
})()
""",
        timeout=10,
    )
    time.sleep(0.5)


def visible_failure_context(client):
    try:
        return client.eval(
            r"""
(() => {
  const visible = (node) => {
    const style = getComputedStyle(node);
    return style && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const modalTexts = Array.from(document.querySelectorAll('.ant-modal, .ant-message, .ant-notification, .ant-tooltip'))
    .filter(visible)
    .map((node) => String(node.innerText || node.textContent || '').trim())
    .filter(Boolean)
    .join('\n');
  const body = String(document.body && document.body.innerText || '').slice(0, 4000);
  return [modalTexts, body].filter(Boolean).join('\n');
})()
""",
            timeout=10,
        ) or ""
    except Exception:
        return ""


def open_preview_modal(client, item):
    drama_id = str(item.get("dramaId") or item.get("taskId") or "").strip()
    title = str(item.get("title") or item.get("enName") or item.get("chName") or "").strip()
    if not drama_id and not title:
        raise RuntimeError("Cannot open MoboBoost preview: missing drama id/title")

    existing = client.eval(
        """
(() => {
  const dramaId = %s;
  const title = %s;
  const modal = Array.from(document.querySelectorAll('.ant-modal'))
    .find((node) => getComputedStyle(node).display !== 'none');
  const text = modal ? String(modal.innerText || '') : '';
  return Boolean(modal && ((dramaId && text.includes(dramaId)) || (title && text.includes(title))));
})()
"""
        % (json.dumps(drama_id), json.dumps(title)),
        timeout=10,
    )
    if existing:
        return

    close_visible_modals(client)
    result = json.loads(
        client.eval(
            r"""
(() => {
  const dramaId = %s;
  const title = %s;
  const textOf = (node) => String(node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
  const recordNodes = Array.from(document.querySelectorAll('[class*="record-"]'));
  const fallbackNodes = Array.from(document.querySelectorAll('.ant-list-item, .ant-card, .ant-row'));
  const records = [...recordNodes, ...fallbackNodes];
  const record = records.find((node) => {
    const text = textOf(node);
    return (dramaId && text.includes('(' + dramaId + ')')) || (title && text.includes(title));
  });
  if (!record) return JSON.stringify({ok:false, reason:'record_not_found'});
  record.scrollIntoView({block:'center', inline:'center'});
  const previewText = '\u9884\u89c8';
  const preview = Array.from(record.querySelectorAll('button, a, [role="button"], div, span'))
    .find((node) => textOf(node) === previewText || String(node.className || '').includes('ant-image-mask'));
  if (preview) {
    preview.click();
    return JSON.stringify({ok:true, clicked:'preview'});
  }
  const rect = record.getBoundingClientRect();
  const target = document.elementFromPoint(rect.left + 70, rect.top + 30) || record;
  target.click();
  return JSON.stringify({ok:true, clicked:'record_fallback'});
})()
"""
            % (json.dumps(drama_id), json.dumps(title)),
            timeout=20,
        )
    )
    if not result.get("ok"):
        raise RuntimeError(f"MoboBoost preview record not found: {title or drama_id}")

    for _ in range(30):
        opened = client.eval(
            """
(() => {
  const dramaId = %s;
  const title = %s;
  const modal = Array.from(document.querySelectorAll('.ant-modal'))
    .find((node) => getComputedStyle(node).display !== 'none');
  const text = modal ? String(modal.innerText || '') : '';
  return Boolean(modal && ((dramaId && text.includes(dramaId)) || (title && text.includes(title))));
})()
"""
            % (json.dumps(drama_id), json.dumps(title)),
            timeout=10,
        )
        if opened:
            time.sleep(1)
            return
        time.sleep(1)
    raise RuntimeError(f"MoboBoost preview did not open: {title or drama_id}")


def visible_episode_numbers(client):
    values = json.loads(
        client.eval(
            r"""
(() => {
  const modal = Array.from(document.querySelectorAll('.ant-modal'))
    .find((node) => getComputedStyle(node).display !== 'none');
  if (!modal) return JSON.stringify([]);
  const numbers = Array.from(modal.querySelectorAll('[class*="episodeItem"]'))
    .map((node) => Number(String(node.innerText || node.textContent || '').trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
  return JSON.stringify([...new Set(numbers)].sort((a, b) => a - b));
})()
""",
            timeout=10,
        )
    )
    return values


def open_batch_download_dialog(client):
    result = json.loads(
        client.eval(
            r"""
(() => {
  const modal = Array.from(document.querySelectorAll('.ant-modal'))
    .find((node) => getComputedStyle(node).display !== 'none');
  if (!modal) return JSON.stringify({ok:false, reason:'preview_modal_not_visible'});
  const btn = Array.from(modal.querySelectorAll('button'))
    .find((node) => String(node.innerText || node.textContent || '').includes('\u6279\u91cf\u4e0b\u8f7d'));
  if (!btn) return JSON.stringify({ok:false, reason:'batch_button_not_found'});
  btn.click();
  return JSON.stringify({ok:true});
})()
""",
            timeout=10,
        )
    )
    if not result.get("ok"):
        raise RuntimeError(f"MoboBoost batch download button not found: {result.get('reason')}")
    for _ in range(20):
        visible = client.eval(
            r"""
Boolean(Array.from(document.querySelectorAll('.ant-modal.batchDownloadModal-Fv8UBodE'))
  .find((node) => getComputedStyle(node).display !== 'none'))
""",
            timeout=10,
        )
        if visible:
            return
        time.sleep(0.5)
    raise RuntimeError("MoboBoost batch download dialog did not open")


def click_record_download_action(client, item, video_type):
    drama_id = str(item.get("dramaId") or item.get("taskId") or "").strip()
    title = str(item.get("title") or item.get("enName") or item.get("chName") or "").strip()
    if not drama_id and not title:
        raise RuntimeError("Cannot click MoboBoost download action: missing drama id/title")
    action_label = "\u539f\u7247\u4e0b\u8f7d" if video_type == "origin" else "\u7d20\u6750\u4e0b\u8f7d"
    result = json.loads(
        client.eval(
            r"""
(() => {
  const dramaId = %s;
  const title = %s;
  const actionLabel = %s;
  const textOf = (node) => String(node && (node.innerText || node.textContent) || '').replace(/\s+/g, ' ').trim();
  const records = Array.from(document.querySelectorAll('[class*="record-"]'));
  const record = records.find((node) => {
    const text = textOf(node);
    return (dramaId && text.includes('(' + dramaId + ')')) || (title && text.includes(title));
  });
  if (!record) return JSON.stringify({ok:false, reason:'record_not_found'});
  record.scrollIntoView({block:'center', inline:'center'});
  const actionColumn = record.querySelector('[class*="actionColumn"]');
  const candidates = Array.from(record.querySelectorAll('a, button, [role="button"], span, div'));
  let target = candidates.find((node) => textOf(node) === actionLabel);
  if (!target && actionColumn) {
    const rect = actionColumn.getBoundingClientRect();
    const ratio = actionLabel.includes('原片') ? 0.57 : 0.90;
    target = document.elementFromPoint(rect.left + rect.width * ratio, rect.top + rect.height / 2);
  }
  if (!target) {
    return JSON.stringify({ok:false, reason:'download_action_not_found', actionText: actionColumn ? textOf(actionColumn) : ''});
  }
  if (typeof target.click === 'function') {
    target.click();
  } else {
    target.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, view:window}));
  }
  return JSON.stringify({ok:true, clicked: actionLabel, tag: target.tagName, className: String(target.className || ''), text: textOf(target)});
})()
"""
            % (json.dumps(drama_id), json.dumps(title), json.dumps(action_label)),
            timeout=20,
        )
    )
    if not result.get("ok"):
        raise RuntimeError(f"MoboBoost download action not found: {result.get('reason')} {result.get('actionText') or ''}".strip())
    time.sleep(2)
    return result


def submit_batch_download(client, video_type, start_episode, end_episode):
    type_label = {
        "origin": "\u539f\u89c6\u9891",
        "subtitle": "\u5b57\u5e55\u89c6\u9891",
    }[video_type]
    result = json.loads(
        client.eval(
            r"""
(() => {
  const typeLabel = %s;
  const startEpisode = %s;
  const endEpisode = %s;
  const modal = Array.from(document.querySelectorAll('.ant-modal.batchDownloadModal-Fv8UBodE'))
    .find((node) => getComputedStyle(node).display !== 'none');
  if (!modal) return JSON.stringify({ok:false, reason:'batch_modal_not_visible'});
  const label = Array.from(modal.querySelectorAll('label'))
    .find((node) => String(node.innerText || node.textContent || '').includes(typeLabel));
  if (label) label.click();
  const inputs = Array.from(modal.querySelectorAll('input.ant-input-number-input'));
  const setValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, String(value));
    input.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:String(value)}));
    input.dispatchEvent(new Event('change', {bubbles:true}));
  };
  if (!inputs[0] || !inputs[1]) return JSON.stringify({ok:false, reason:'range_inputs_not_found'});
  setValue(inputs[0], startEpisode);
  setValue(inputs[1], endEpisode);
  const submit = Array.from(modal.querySelectorAll('button'))
    .find((node) => String(node.innerText || node.textContent || '').replace(/\s+/g, '').includes('\u4e0b\u8f7d'));
  if (!submit) return JSON.stringify({ok:false, reason:'submit_not_found'});
  submit.click();
  return JSON.stringify({ok:true, values: inputs.map((input) => input.value)});
})()
"""
            % (json.dumps(type_label), json.dumps(start_episode), json.dumps(end_episode)),
            timeout=20,
        )
    )
    if not result.get("ok"):
        raise RuntimeError(f"MoboBoost batch download submit failed: {result.get('reason')}")


def detail_download_view_ready(client):
    try:
        return bool(
            client.eval(
                r"""
Boolean(Array.from(document.querySelectorAll('[class*="episodeItem"]')).length
  && Array.from(document.querySelectorAll('button'))
    .some((node) => String(node.innerText || node.textContent || '').includes('\u4e0b\u8f7d\u539f\u89c6\u9891')))
""",
                timeout=10,
            )
        )
    except Exception:
        return False


def detail_download_button_visible(client, button_label):
    try:
        return bool(
            client.eval(
                r"""
(() => {
  const buttonLabel = %s;
  const textOf = (node) => String(node && (node.innerText || node.textContent) || '').replace(/\s+/g, ' ').trim();
  const modal = Array.from(document.querySelectorAll('.ant-modal'))
    .find((node) => getComputedStyle(node).display !== 'none');
  const root = modal || document;
  return Array.from(root.querySelectorAll('button, a, [role="button"], span, div'))
    .some((node) => textOf(node).includes(buttonLabel));
})()
"""
                % json.dumps(button_label),
                timeout=10,
            )
        )
    except Exception:
        return False


def wait_detail_download_button_visible(client, button_label, timeout_seconds=30):
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        if detail_download_button_visible(client, button_label):
            return True
        time.sleep(0.5)
    return False


def current_detail_matches_item(client, item):
    drama_id = str(item.get("dramaId") or item.get("taskId") or "").strip()
    title = str(item.get("title") or item.get("enName") or item.get("chName") or "").strip()
    try:
        body = client.eval(
            r"""
(() => {
  const modal = Array.from(document.querySelectorAll('.ant-modal'))
    .find((node) => getComputedStyle(node).display !== 'none');
  return String(modal && (modal.innerText || modal.textContent) || '');
})()
""",
            timeout=10,
        )
    except Exception:
        return False
    return bool((drama_id and drama_id in body) or (title and title in body))


def close_visible_modals(client):
    try:
        client.eval(
            r"""
(() => {
  for (const button of Array.from(document.querySelectorAll('button.ant-modal-close'))) {
    if (button.offsetParent !== null) button.click();
  }
  return true;
})()
""",
            timeout=10,
        )
    except Exception:
        pass


def click_detail_tab(client, label):
    result = json.loads(
        client.eval(
            r"""
(() => {
  const label = %s;
  const modal = Array.from(document.querySelectorAll('.ant-modal'))
    .find((node) => getComputedStyle(node).display !== 'none');
  const root = modal || document;
  const textOf = (node) => String(node && (node.innerText || node.textContent) || '').replace(/\s+/g, ' ').trim();
  const tab = Array.from(root.querySelectorAll('[role=tab], .ant-tabs-tab-btn'))
    .find((node) => textOf(node).includes(label));
  if (!tab) {
    return JSON.stringify({ok:false, reason:'tab_not_found', label, tabs:Array.from(root.querySelectorAll('[role=tab], .ant-tabs-tab-btn')).map(textOf)});
  }
  const target = tab.closest('.ant-tabs-tab') || tab;
  target.scrollIntoView({block:'center', inline:'center'});
  target.dispatchEvent(new MouseEvent('mouseover', {bubbles:true, cancelable:true, view:window}));
  target.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, cancelable:true, view:window}));
  target.dispatchEvent(new MouseEvent('mouseup', {bubbles:true, cancelable:true, view:window}));
  target.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, view:window}));
  if (typeof target.click === 'function') target.click();
  return JSON.stringify({ok:true, label, text:textOf(tab)});
})()
"""
            % json.dumps(label),
            timeout=20,
        )
    )
    if not result.get("ok"):
        raise RuntimeError(f"MoboBoost detail tab not found: {result.get('reason')} {result.get('tabs') or ''}")
    time.sleep(2)
    return result


def wait_detail_episode_active(client, episode, timeout_seconds=15):
    deadline = time.time() + timeout_seconds
    last_state = None
    while time.time() < deadline:
        state = json.loads(
            client.eval(
                r"""
(() => {
  const textOf = (node) => String(node && (node.innerText || node.textContent) || '').replace(/\s+/g, ' ').trim();
  const active = Array.from(document.querySelectorAll('[class*="activeEpisode"]')).map(textOf);
  const videos = Array.from(document.querySelectorAll('video')).map((video) => ({
    src: video.currentSrc || video.src || '',
    readyState: video.readyState,
    networkState: video.networkState,
    error: video.error && video.error.code
  }));
  return JSON.stringify({active, videos});
})()
""",
                timeout=10,
            )
        )
        last_state = state
        if str(episode) in [str(value).strip() for value in state.get("active", [])]:
            time.sleep(2)
            return state
        time.sleep(0.5)
    raise RuntimeError(f"MoboBoost episode {episode} did not become active: {last_state}")


def wait_current_video_src(client, episode, timeout_seconds=30):
    deadline = time.time() + timeout_seconds
    last_value = ""
    expected_marker = f"_{episode}.mp4"
    while time.time() < deadline:
        value = client.eval(
            r"""
Array.from(document.querySelectorAll('video'))
  .map((video) => video.currentSrc || video.src || '')
  .find(Boolean) || ''
""",
            timeout=10,
        ) or ""
        last_value = value
        if value and (expected_marker in value or f"%5F{episode}.mp4" in value or "download_name=" in value):
            return value
        time.sleep(0.5)
    raise RuntimeError(f"MoboBoost episode {episode} video URL not ready: {last_value}")


def download_url_to_file(url, target_path, user_agent):
    target_path = Path(target_path)
    target_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = target_path.with_suffix(target_path.suffix + ".tmp")
    if tmp_path.exists():
        tmp_path.unlink()
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": user_agent,
            "Referer": ENTRY_URL,
            "Origin": "https://ckoc.cdreader.com",
            "Accept": "*/*",
        },
    )
    with urllib.request.urlopen(request, timeout=180) as response, open(tmp_path, "wb") as output:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            output.write(chunk)
    if not tmp_path.exists() or tmp_path.stat().st_size <= 0:
        raise RuntimeError(f"MoboBoost direct download produced empty file: {target_path}")
    if target_path.exists():
        target_path.unlink()
    tmp_path.replace(target_path)
    return target_path


def direct_episode_video_path(item, video_type, episode, download_dir):
    if video_type == "origin":
        raw_title = item.get("title") or item.get("enName") or item.get("chName") or "moboboost"
        return download_dir / f"{site_filename_part(raw_title)}-\u7b2c{episode}\u96c6.mp4"
    return download_dir / moboboost_episode_filename(item, video_type, episode)


def download_detail_episode_direct(client, item, video_type, episode, download_dir):
    if video_type != "origin":
        raise RuntimeError("Direct video URL download currently supports origin videos only")
    click_detail_tab(client, "\u539f\u7247")
    select_result = json.loads(
        client.eval(
            r"""
(() => {
  const episode = %s;
  const textOf = (node) => String(node && (node.innerText || node.textContent) || '').replace(/\s+/g, ' ').trim();
  const episodeItems = Array.from(document.querySelectorAll('[class*="episodeItem"]'));
  const selectedEpisode = episodeItems.find((node) => textOf(node) === String(episode));
  if (!selectedEpisode) return JSON.stringify({ok:false, visibleEpisodes: episodeItems.map(textOf).filter(Boolean).slice(0, 80)});
  selectedEpisode.scrollIntoView({block:'center', inline:'center'});
  selectedEpisode.dispatchEvent(new MouseEvent('mouseover', {bubbles:true, cancelable:true, view:window}));
  selectedEpisode.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, cancelable:true, view:window}));
  selectedEpisode.dispatchEvent(new MouseEvent('mouseup', {bubbles:true, cancelable:true, view:window}));
  selectedEpisode.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, view:window}));
  if (typeof selectedEpisode.click === 'function') selectedEpisode.click();
  return JSON.stringify({ok:true, episode, text:textOf(selectedEpisode)});
})()
"""
            % json.dumps(episode),
            timeout=20,
        )
    )
    if not select_result.get("ok"):
        raise RuntimeError(f"MoboBoost detail episode not found: {select_result.get('visibleEpisodes')}")
    active_state = wait_detail_episode_active(client, episode)
    video_url = wait_current_video_src(client, episode)
    user_agent = client.eval("navigator.userAgent", timeout=10) or "Mozilla/5.0"
    target_path = direct_episode_video_path(item, video_type, episode, download_dir)
    saved_path = download_url_to_file(video_url, target_path, user_agent)
    return {"path": saved_path, "url": video_url, "activeState": active_state}


def open_record_preview(client, item):
    if detail_download_view_ready(client) and current_detail_matches_item(client, item):
        return {"ok": True, "alreadyOpen": True}
    if current_detail_matches_item(client, item):
        try:
            click_detail_tab(client, "\u539f\u7247")
            if detail_download_view_ready(client):
                return {"ok": True, "alreadyOpen": True, "switchedTab": "\u539f\u7247"}
        except Exception:
            pass
    close_visible_modals(client)
    result = click_record_download_action(client, item, "origin")
    for _ in range(30):
        if current_detail_matches_item(client, item):
            click_detail_tab(client, "\u539f\u7247")
        if detail_download_view_ready(client):
            return result
        time.sleep(0.5)
    raise RuntimeError("MoboBoost detail preview did not open")


def click_detail_episode_download(client, episode, video_type):
    button_label = "\u4e0b\u8f7d\u539f\u89c6\u9891" if video_type == "origin" else "\u4e0b\u8f7d\u5b57\u5e55\u89c6\u9891"
    if not detail_download_button_visible(client, button_label):
        click_detail_tab(client, "\u539f\u7247" if video_type == "origin" else "\u7d20\u6750")
    select_result = json.loads(
        client.eval(
            r"""
(() => {
  const episode = %s;
  const textOf = (node) => String(node && (node.innerText || node.textContent) || '').replace(/\s+/g, ' ').trim();
  const episodeItems = Array.from(document.querySelectorAll('[class*="episodeItem"]'));
  const selectedEpisode = episodeItems.find((node) => textOf(node) === String(episode));
  if (!selectedEpisode) {
    return JSON.stringify({
      ok:false,
      reason:'episode_not_found',
      episode,
      visibleEpisodes: episodeItems.map(textOf).filter(Boolean).slice(0, 80)
    });
  }
  selectedEpisode.scrollIntoView({block:'center', inline:'center'});
  selectedEpisode.dispatchEvent(new MouseEvent('mouseover', {bubbles:true, cancelable:true, view:window}));
  selectedEpisode.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, cancelable:true, view:window}));
  selectedEpisode.dispatchEvent(new MouseEvent('mouseup', {bubbles:true, cancelable:true, view:window}));
  selectedEpisode.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, view:window}));
  if (typeof selectedEpisode.click === 'function') selectedEpisode.click();
  return JSON.stringify({ok:true, episode, text:textOf(selectedEpisode)});
})()
"""
            % json.dumps(episode),
            timeout=20,
        )
    )
    if not select_result.get("ok"):
        raise RuntimeError(f"MoboBoost detail episode not found: {select_result.get('reason')} {select_result.get('visibleEpisodes')}")
    active_state = wait_detail_episode_active(client, episode)
    wait_detail_download_button_visible(client, button_label, timeout_seconds=20)
    result = json.loads(
        client.eval(
            r"""
(() => {
  const episode = %s;
  const buttonLabel = %s;
  const textOf = (node) => String(node && (node.innerText || node.textContent) || '').replace(/\s+/g, ' ').trim();
  const buttons = Array.from(document.querySelectorAll('button, a, [role="button"], span, div'));
  const exact = buttons.filter((node) => textOf(node) === buttonLabel);
  const button = exact.find((node) => node.tagName === 'BUTTON')
    || exact.find((node) => node.tagName === 'A' || node.getAttribute('role') === 'button')
    || exact[0]
    || buttons.find((node) => textOf(node).includes(buttonLabel) && node.tagName === 'BUTTON');
  if (!button) {
    return JSON.stringify({
      ok:false,
      reason:'detail_download_button_not_found',
      buttonLabel,
      visibleButtons: buttons.map(textOf).filter(Boolean).slice(0, 30),
      body: String(document.body && document.body.innerText || '').slice(0, 2000)
    });
  }
  button.scrollIntoView({block:'center', inline:'center'});
  if (typeof button.click === 'function') {
    button.click();
  } else {
    button.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, view:window}));
  }
  return JSON.stringify({ok:true, episode, buttonLabel, text:textOf(button)});
})()
"""
            % (json.dumps(episode), json.dumps(button_label)),
            timeout=20,
        )
    )
    if not result.get("ok"):
        raise RuntimeError(f"MoboBoost detail download button not found: {result.get('reason')} {result.get('buttonLabel')}")
    time.sleep(1)
    result["activeState"] = active_state
    return result


def collect_downloaded_files(client, item, output_dir, args):
    download_types = ["origin", "subtitle"] if args.download_types == "both" else [args.download_types]
    download_dir = output_dir / "downloads" / safe_filename_part(f"{item.get('platform')}_{item.get('dramaId')}_{item.get('title')}")
    download_dir = download_dir.resolve()
    set_download_behavior(client, download_dir)
    downloaded = []
    failure_contexts = []
    start_episode = args.download_start or 1
    end_episode = args.download_end or start_episode
    preview_result = open_record_preview(client, item)
    print(
        f"MoboBoost download detail ready: title={item.get('title') or item.get('dramaId')} "
        f"alreadyOpen={bool(preview_result.get('alreadyOpen'))}",
        flush=True,
    )
    for video_type in download_types:
        files = []
        for episode_number in range(start_episode, end_episode + 1):
            before_names = {path.name for path in completed_download_files(download_dir)}
            target_path = download_dir / moboboost_episode_filename(item, video_type, episode_number)
            try:
                clicked = False
                try:
                    detail_result = click_detail_episode_download(client, episode_number, video_type)
                    print(f"MoboBoost clicked {video_type} episode {episode_number}: {detail_result}", flush=True)
                    clicked = True
                except Exception as detail_exc:
                    failure_contexts.append(f"{video_type} ep{episode_number}: detail click failed: {detail_exc}")
                    click_record_download_action(client, item, video_type)
                    clicked = True

                saved = save_native_save_as_dialog(target_path, timeout_seconds=10)
                print(f"MoboBoost native Save As {video_type} episode {episode_number}: saved={saved}", flush=True)
                if saved:
                    native_files = wait_for_downloads(
                        download_dir,
                        before_names,
                        1,
                        args.download_timeout,
                    )
                    if target_path.exists() and target_path.name not in before_names:
                        files.append(target_path)
                    else:
                        files.extend(canonicalize_downloaded_episode_file(path, target_path) for path in native_files[:1])
                    print(
                        f"MoboBoost disk files after {video_type} episode {episode_number}: "
                        f"{[path.name for path in files]}",
                        flush=True,
                    )
                elif clicked:
                    browser_files = wait_for_browser_downloads(client, download_dir, before_names, 1, args.download_timeout)
                    if browser_files:
                        files.extend(canonicalize_downloaded_episode_file(path, target_path) for path in browser_files[:1])
                    else:
                        late_file = find_completed_episode_file(
                            download_dir,
                            item,
                            video_type,
                            episode_number,
                            include_untyped=True,
                        )
                        if late_file and late_file.name not in before_names:
                            files.append(canonicalize_downloaded_episode_file(late_file, target_path))
            except Exception as exc:
                failure_contexts.append(f"{video_type} ep{episode_number}: {exc}")
                failure_contexts.append(visible_failure_context(client))
        unique_files = []
        seen_paths = set()
        for path in files:
            resolved = str(path.resolve())
            if resolved in seen_paths:
                continue
            seen_paths.add(resolved)
            unique_files.append(path)
        for path in unique_files:
            number_matches = re.findall(r"(\d+)", path.stem)
            episode = int(number_matches[-1]) if number_matches else None
            kind_prefix = "episode_video" if video_type == "origin" else "subtitle_video"
            downloaded.append(
                {
                    "kind": f"{kind_prefix}_{episode}" if episode else kind_prefix,
                    "localPath": str(path),
                    "sourceUrl": "",
                    "episode": episode,
                    "downloadType": video_type,
                }
            )
        if not unique_files:
            failure_contexts.append(f"{video_type}: no completed files")
            failure_contexts.append(visible_failure_context(client))
        # If the dialog remains open after submission, close it before the next type.
        try:
            client.eval(
                r"""
(() => {
  const modal = Array.from(document.querySelectorAll('.ant-modal.batchDownloadModal-Fv8UBodE'))
    .find((node) => getComputedStyle(node).display !== 'none');
  const close = modal && modal.querySelector('button.ant-modal-close');
  if (close) close.click();
  return true;
})()
""",
                timeout=10,
            )
        except Exception as exc:
            failure_contexts.append(f"{video_type}: close dialog failed: {exc}")
        time.sleep(0.5)

    downloaded = reconcile_expected_downloaded_files(downloaded, item, download_dir, download_types, start_episode, end_episode)

    item["downloadMode"] = "browser_detail_download"
    item["downloadRange"] = {"start": start_episode, "end": end_episode}
    item["downloadedFiles"] = downloaded
    origin_requested = "origin" in download_types
    origin_downloaded = any(file.get("downloadType") == "origin" for file in downloaded)
    if origin_downloaded:
        item["originalVideoStatus"] = "downloaded"
        item["originalVideoFailureCode"] = ""
        item["originalVideoFailureReason"] = ""
    elif origin_requested:
        code, reason = classify_download_failure(
            "\n".join([*(failure_contexts or []), str(item.get("rawText") or ""), str(item.get("downloadError") or "")])
        )
        item["originalVideoStatus"] = "failed"
        item["originalVideoFailureCode"] = code
        item["originalVideoFailureReason"] = reason
        item["downloadMode"] = "browser_download_failed"
        item["downloadError"] = reason
    else:
        item["originalVideoStatus"] = "not_requested"
        item["originalVideoFailureCode"] = ""
        item["originalVideoFailureReason"] = ""
    return downloaded


def parse_body_lines(lines, cover_images):
    languages = [
        "\u7b80\u4f53",
        "\u7e41\u4f53",
        "\u82f1\u8bed",
        "\u897f\u8bed",
        "\u8461\u8bed",
        "\u6cd5\u8bed",
        "\u4fc4\u8bed",
        "\u610f\u5927\u5229\u8bed",
        "\u65e5\u8bed",
        "\u963f\u62c9\u4f2f\u8bed",
        "\u5370\u5c3c",
        "\u6cf0\u8bed",
        "\u8d8a\u5357\u8bed",
        "\u97e9\u8bed",
        "\u83f2\u5f8b\u5bbe\u8bed",
        "\u5fb7\u8bed",
        "\u5370\u5730\u8bed",
        "\u9a6c\u6765\u897f\u4e9a\u8bed",
        "\u571f\u8033\u5176\u8bed",
        "\u6ce2\u5170\u8bed",
    ]
    material_actions = [
        "\u751f\u6210\u63a8\u5e7f\u8d44\u6e90",
        "\u6dfb\u52a0\u81f3MoboTree",
        "TTO\u951a\u70b9",
        "\u590d\u5236\u7f51\u76d8\u5730\u5740",
        "\u539f\u7247\u4e0b\u8f7d",
        "\u7d20\u6750\u4e0b\u8f7d",
    ]

    def line_after(segment, label):
        for index, value in enumerate(segment[:-1]):
            if value == label:
                return segment[index + 1]
        return ""

    def first_in(segment, options):
        return next((option for option in options if option in segment), "")

    def first_match(segment, pattern):
        import re

        joined = "\n".join(segment)
        match = re.search(pattern, joined)
        return match.group(1) if match else ""

    start_indexes = [index for index, value in enumerate(lines) if value == "\u9884\u89c8"]
    items = []
    seen = set()
    for position, start in enumerate(start_indexes):
        end = start_indexes[position + 1] if position + 1 < len(start_indexes) else len(lines)
        segment = lines[start:end]
        drama_id = first_match(segment, r"\((\d{4,})\)")
        if not drama_id:
            continue
        id_line_index = next((i for i, value in enumerate(segment) if value == f"({drama_id})"), -1)
        title = ""
        if id_line_index > 0:
            title = segment[id_line_index - 1]
        if not title:
            title = next((value for value in segment if any(ch.isalpha() for ch in value) and len(value) >= 8), "")
        key = f"{drama_id}|{title}"
        if key in seen:
            continue
        seen.add(key)
        joined = "\n".join(segment)
        platform = first_in(joined, [name for name in KNOWN_PLATFORMS if name != "\u5168\u90e8\u5e73\u53f0"])
        description = next(
            (
                value
                for value in segment
                if len(value) > 45
                and not value.startswith("http")
                and "\u5206\u4f63\u6bd4\u4f8b" not in value
                and value != title
            ),
            "",
        )
        items.append(
            {
                "index": len(items),
                "displayIndex": len(items) + 1,
                "dramaId": drama_id,
                "title": title,
                "platform": platform,
                "language": first_in(joined, languages),
                "dramaType": "\u539f\u58f0\u5267"
                if "\u539f\u58f0\u5267" in joined
                else ("\u914d\u97f3\u5267" if "\u914d\u97f3\u5267" in joined else ""),
                "subType": "AI" if "AI" in segment else ("\u771f\u4eba" if "\u771f\u4eba" in joined else ""),
                "commissionRate": first_match(segment, r"\u5206\u4f63\u6bd4\u4f8b[:\uff1a]?\s*([0-9.]+%)"),
                "paidFromEpisode": first_match(segment, r"\u7b2c\s*(\d+)\s*\u96c6\u5f00\u59cb\u6536\u8d39"),
                "coverImageUrl": cover_images[len(items)] if len(items) < len(cover_images) else "",
                "shortDramaLink": line_after(segment, "\u77ed\u5267\u94fe\u63a5"),
                "appLink": line_after(segment, "App\u94fe\u63a5"),
                "cloudDriveLink": line_after(segment, "\u7f51\u76d8\u5730\u5740"),
                "description": description,
                "materialActions": [action for action in material_actions if action in segment],
                "rawText": "\n".join(segment[:80]),
            }
        )
    return items


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def parse_args():
    parser = argparse.ArgumentParser(description="Scrape MoboBoost/CDReader CPS content center")
    parser.add_argument("--output", required=True, help="Output directory")
    parser.add_argument("--list-only", action="store_true", help="Only discover platform tabs and drama candidates")
    parser.add_argument("--platform", default="", help="MoboBoost inner platform tab, for example MoboReels")
    parser.add_argument("--tasks", nargs="*", type=int, default=None, help="Selected drama candidate indices")
    parser.add_argument("--all", action="store_true", help="Collect all visible candidates")
    parser.add_argument("--no-download", action="store_true", help="Do not click download actions; generate download tasks only")
    parser.add_argument("--download-types", choices=["origin", "subtitle", "both"], default="origin", help="Video assets to download from the MoboBoost batch dialog")
    parser.add_argument("--download-start", type=int, default=None, help="First episode number to download; defaults to first visible episode")
    parser.add_argument("--download-end", type=int, default=None, help="Last episode number to download; defaults to last visible episode")
    parser.add_argument("--download-timeout", type=int, default=300, help="Seconds to wait for each batch download")
    return parser.parse_args()


def main():
    args = parse_args()
    output_dir = Path(args.output)
    client = connect()
    try:
        ensure_moboboost_page(client)
        if args.platform:
            click_platform(client, args.platform)
        data = parse_visible_data(client)
        platforms = data.get("platforms", [])
        candidates = data.get("items", [])
        write_json(output_dir / "platform_tabs.json", platforms)
        write_json(output_dir / "task_candidates.json", candidates)

        if args.list_only:
            print(f"MoboBoost discover complete: {len(platforms)} platforms, {len(candidates)} candidates")
            return

        if args.all:
            selected = candidates
        else:
            indices = args.tasks if args.tasks is not None else [0]
            selected = []
            for index in indices:
                if index < 0 or index >= len(candidates):
                    raise RuntimeError(f"Task index out of range: {index}; candidates={len(candidates)}")
                selected.append(candidates[index])

        for item in selected:
            actions = item.get("materialActions") or []
            item["downloadTasks"] = [
                {"action": action, "status": "pending_browser_confirmation"}
                for action in actions
            ]
            if args.no_download:
                item["downloadMode"] = "generated_task_only"
                item["originalVideoStatus"] = "not_requested"
                item["originalVideoFailureCode"] = ""
                item["originalVideoFailureReason"] = ""
            else:
                try:
                    downloaded = collect_downloaded_files(client, item, output_dir, args)
                    if downloaded:
                        item["downloadTasks"] = [
                            {
                                "action": f"batch_download_{file.get('downloadType', 'origin')}_{file.get('episode') or index + 1}",
                                "status": "ready",
                                "url": file.get("localPath", ""),
                            }
                            for index, file in enumerate(downloaded)
                        ]
                    else:
                        item["downloadMode"] = "browser_download_no_files"
                except Exception as exc:
                    item["downloadMode"] = "browser_download_failed"
                    item["downloadError"] = str(exc)
                    raise

        write_json(output_dir / "cps_results.json", selected)
        print(f"MoboBoost collect complete: {len(selected)} selected drama(s)")
    finally:
        client.close()


if __name__ == "__main__":
    main()
