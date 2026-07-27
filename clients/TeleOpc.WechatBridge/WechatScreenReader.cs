using System.Diagnostics;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace TeleOpc.WechatBridge;

public sealed class WechatScreenReader
{
    readonly LocalOcr ocr = new();
    public Action<string>? Log { get; set; }
    readonly string stateDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TeleOpc", "WechatBridge", "screen-reader");
    readonly string statePath;
    ScreenReaderState state;
    bool notificationBaselineReady;
    readonly Dictionary<string, DateTimeOffset> seenNotifications = new(StringComparer.Ordinal);

    public WechatScreenReader()
    {
        statePath = Path.Combine(stateDir, "state.json");
        state = LoadState();
    }

    public string ModeDescription => "微信 4.1 后台截图 + Windows 本地 OCR";

    public async Task<IReadOnlyList<WechatInbound>> ReadNewAsync(bool allowGroups, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var hwnd = WechatWindow.Find();
        if (hwnd == IntPtr.Zero) throw new InvalidOperationException("没有找到已登录的微信主窗口。");

        var notificationMessages = await ReadNotificationsAsync(hwnd, allowGroups, ct);
        using var capture = WechatWindow.Capture(hwnd);
        var layout = ScreenLayout.From(capture.Width, capture.Height);
        var listHash = HashRegion(capture, layout.ListBounds);
        if (state.Initialized && string.Equals(state.ListHash, listHash, StringComparison.Ordinal)) return notificationMessages;

        var screenshot = await SaveTemporaryCaptureAsync(capture, "session-list.png", ct);
        OcrSnapshot snapshot;
        try { snapshot = await ocr.RecognizeLayoutAsync(screenshot); }
        finally { TryDelete(screenshot); }

        var sessions = ReadSessions(capture, snapshot, layout);
        Log?.Invoke($"会话扫描 {capture.Width}×{capture.Height}：" + string.Join("；", sessions.Select(x => $"{x.Name}[未读={x.HasUnread},红={x.RedPixels}]")));
        if (!state.Initialized)
        {
            state = new ScreenReaderState(true, listHash, sessions.ToDictionary(x => x.Key, x => x.RowHash, StringComparer.Ordinal));
            SaveState();
            Log?.Invoke($"屏幕读取基线已建立：识别到 {sessions.Count} 个可见会话，未处理启动前旧消息。");
            return notificationMessages;
        }

        var candidates = sessions
            .Where(x => x.HasUnread && (!state.SessionHashes.TryGetValue(x.Key, out var oldHash) || !string.Equals(oldHash, x.RowHash, StringComparison.Ordinal)))
            .ToList();
        if (candidates.Count > 0) Log?.Invoke($"会话列表发现 {candidates.Count} 个新未读变化，开始校验。");
        var messages = new List<WechatInbound>(notificationMessages);
        var priorForeground = WechatWindow.GetForeground();

        try
        {
            foreach (var session in candidates)
            {
                ct.ThrowIfCancellationRequested();
                WechatWindow.FocusAndClick(hwnd, layout.ListCenterX, session.CenterY);
                await Task.Delay(650, ct);
                using var conversation = WechatWindow.Capture(hwnd);
                var conversationPath = await SaveTemporaryCaptureAsync(conversation, "conversation.png", ct);
                OcrSnapshot conversationOcr;
                try { conversationOcr = await ocr.RecognizeLayoutAsync(conversationPath); }
                finally { TryDelete(conversationPath); }

                var parsed = ParseConversation(conversationOcr, ScreenLayout.From(conversation.Width, conversation.Height), IsReliableSessionName(session.Name) ? session.Name : null, session.Key, session.RowHash);
                if (parsed is null) { Log?.Invoke($"会话“{session.Name}”标题或消息 OCR 校验失败，已跳过。"); continue; }
                if (parsed.IsGroup && !allowGroups) { Log?.Invoke($"群聊“{parsed.ConversationName}”已按设置跳过。"); continue; }
                messages.Add(new WechatInbound(
                    parsed.MessageId,
                    parsed.ConversationId,
                    parsed.ConversationName,
                    parsed.Text,
                    parsed.IsGroup,
                    DateTimeOffset.UtcNow.ToString("O")
                ));
            }
        }
        finally
        {
            if (priorForeground != IntPtr.Zero && priorForeground != hwnd) WechatWindow.TryFocus(priorForeground);
        }

        state = new ScreenReaderState(true, listHash, sessions.ToDictionary(x => x.Key, x => x.RowHash, StringComparer.Ordinal));
        SaveState();
        return messages;
    }

    async Task<List<WechatInbound>> ReadNotificationsAsync(IntPtr mainWindow, bool allowGroups, CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var stale in seenNotifications.Where(x => now - x.Value > TimeSpan.FromMinutes(10)).Select(x => x.Key).ToList())
            seenNotifications.Remove(stale);

        var popups = WechatWindow.FindNotificationWindows(mainWindow);
        var current = new List<(WechatPopup Popup, string Fingerprint)>();
        foreach (var popup in popups)
        {
            try
            {
                using var image = WechatWindow.Capture(popup.Handle);
                current.Add((popup, $"{popup.Handle}:{HashRegion(image, new Rectangle(0, 0, image.Width, image.Height))}"));
            }
            catch { }
        }
        if (!notificationBaselineReady)
        {
            foreach (var item in current) seenNotifications[item.Fingerprint] = now;
            notificationBaselineReady = true;
            return [];
        }

        var result = new List<WechatInbound>();
        foreach (var item in current.Where(x => !seenNotifications.ContainsKey(x.Fingerprint)))
        {
            Log?.Invoke($"检测到微信右下角新消息弹窗（{item.Popup.Width}×{item.Popup.Height}），正在打开并校验。");
            seenNotifications[item.Fingerprint] = now;
            var prior = WechatWindow.GetForeground();
            try
            {
                WechatWindow.FocusAndClick(item.Popup.Handle, item.Popup.Width / 2, item.Popup.Height / 2);
                await Task.Delay(550, ct);
                var activeMain = WechatWindow.Find();
                if (activeMain == IntPtr.Zero) continue;
                using var conversation = WechatWindow.Capture(activeMain);
                var path = await SaveTemporaryCaptureAsync(conversation, "notification-conversation.png", ct);
                OcrSnapshot snapshot;
                try { snapshot = await ocr.RecognizeLayoutAsync(path); }
                finally { TryDelete(path); }
                var parsed = ParseConversation(snapshot, ScreenLayout.From(conversation.Width, conversation.Height), null, "wechat-contact", item.Fingerprint);
                if (parsed is null) { Log?.Invoke("弹窗已打开，但聊天标题或最新入站消息 OCR 校验失败。"); continue; }
                if (parsed.IsGroup && !allowGroups) { Log?.Invoke($"弹窗对应群聊“{parsed.ConversationName}”，已按设置跳过。"); continue; }
                result.Add(new WechatInbound(parsed.MessageId, parsed.ConversationId, parsed.ConversationName, parsed.Text, parsed.IsGroup, DateTimeOffset.UtcNow.ToString("O")));
            }
            finally
            {
                if (prior != IntPtr.Zero && prior != mainWindow) WechatWindow.TryFocus(prior);
            }
        }
        return result;
    }

    public async Task<ConversationDiagnostic> DiagnoseConversationAsync(int rowIndex, string outputDirectory, CancellationToken ct = default)
    {
        var hwnd = WechatWindow.Find();
        if (hwnd == IntPtr.Zero) throw new InvalidOperationException("没有找到已登录的微信主窗口。");
        Directory.CreateDirectory(outputDirectory);
        using var before = WechatWindow.Capture(hwnd);
        var beforePath = Path.Combine(outputDirectory, "conversation-before.png");
        before.Save(beforePath, ImageFormat.Png);
        var beforeOcr = await ocr.RecognizeLayoutAsync(beforePath);
        var layout = ScreenLayout.From(before.Width, before.Height);
        var sessions = ReadSessions(before, beforeOcr, layout);
        var session = sessions.FirstOrDefault(x => x.Index == rowIndex) ?? throw new InvalidOperationException($"没有识别到第 {rowIndex + 1} 行会话。");
        WechatWindow.FocusAndClick(hwnd, layout.ListCenterX, session.CenterY);
        await Task.Delay(1400, ct);
        using var after = WechatWindow.Capture(hwnd);
        var afterPath = Path.Combine(outputDirectory, "conversation-after.png");
        after.Save(afterPath, ImageFormat.Png);
        var afterOcr = await ocr.RecognizeLayoutAsync(afterPath);
        var parsed = ParseConversation(afterOcr, ScreenLayout.From(after.Width, after.Height), IsReliableSessionName(session.Name) ? session.Name : null, session.Key, session.RowHash);
        var result = new ConversationDiagnostic(session, parsed?.ConversationName, parsed?.Text, parsed?.IsGroup ?? false, parsed is not null, afterOcr.Text);
        await File.WriteAllTextAsync(Path.Combine(outputDirectory, "conversation-diagnostic.json"), JsonSerializer.Serialize(result, JsonOptions), ct);
        return result;
    }

    public async Task<ScreenReaderDiagnostic> DiagnoseAsync(string outputDirectory, CancellationToken ct = default)
    {
        var hwnd = WechatWindow.Find();
        if (hwnd == IntPtr.Zero) throw new InvalidOperationException("没有找到已登录的微信主窗口。");
        Directory.CreateDirectory(outputDirectory);
        using var capture = WechatWindow.Capture(hwnd);
        var screenshot = Path.Combine(outputDirectory, "wechat-screen.png");
        capture.Save(screenshot, ImageFormat.Png);
        var snapshot = await ocr.RecognizeLayoutAsync(screenshot);
        var sessions = ReadSessions(capture, snapshot, ScreenLayout.From(capture.Width, capture.Height));
        var result = new ScreenReaderDiagnostic(capture.Width, capture.Height, sessions, snapshot.Text);
        await File.WriteAllTextAsync(Path.Combine(outputDirectory, "wechat-screen.json"), JsonSerializer.Serialize(result, JsonOptions), ct);
        return result;
    }

    ParsedConversation? ParseConversation(OcrSnapshot snapshot, ScreenLayout layout, string? expectedName, string fallbackId, string sourceFingerprint)
    {
        var titleLines = snapshot.Lines
            .Where(line => line.Words.Any())
            .Select(line => new PositionedText(line.Text, line.Words.Min(x => x.X), line.Words.Min(x => x.Y), line.Words.Max(x => x.X + x.Width), line.Words.Max(x => x.Y + x.Height)))
            .Where(line => line.Left >= layout.ChatBounds.Left + 15 && line.Top >= layout.Height * .045 && line.Bottom <= layout.Height * .18)
            .OrderBy(line => line.Top)
            .ToList();
        var title = titleLines.Select(x => x.Text.Trim()).FirstOrDefault(x => TextIdentity.Normalize(x).Length > 0);
        if (string.IsNullOrWhiteSpace(title)) return null;
        if (!string.IsNullOrWhiteSpace(expectedName) && !TextIdentity.Matches(expectedName, title)) return null;

        var chatLines = snapshot.Lines
            .Where(line => line.Words.Any())
            .Select(line => new PositionedText(line.Text.Trim(), line.Words.Min(x => x.X), line.Words.Min(x => x.Y), line.Words.Max(x => x.X + x.Width), line.Words.Max(x => x.Y + x.Height)))
            .Where(line => TextIdentity.Normalize(line.Text).Length > 0)
            .Where(line => line.Top >= layout.Height * .18 && line.Bottom <= layout.Height * .82)
            .Where(line => line.Left >= layout.ChatBounds.Left + 25)
            .OrderBy(line => line.Top)
            .ToList();
        if (chatLines.Count == 0) return null;

        var incomingBoundary = layout.ChatBounds.Left + layout.ChatBounds.Width * .49;
        var latest = chatLines.LastOrDefault(line => line.Left < incomingBoundary);
        if (latest is null) return null;

        var bubble = new List<PositionedText> { latest };
        for (var i = chatLines.IndexOf(latest) - 1; i >= 0 && bubble.Count < 6; i--)
        {
            var previous = chatLines[i];
            var top = bubble[0];
            if (top.Top - previous.Bottom > Math.Max(16, layout.Height * .035)) break;
            if (previous.Left >= incomingBoundary || Math.Abs(previous.Left - latest.Left) > layout.ChatBounds.Width * .18) break;
            bubble.Insert(0, previous);
        }
        var text = string.Join("\n", bubble.Select(x => x.Text).Where(x => !string.IsNullOrWhiteSpace(x))).Trim();
        if (text.Length == 0) return null;

        var group = LooksLikeGroup(title);
        var normalizedTitle = TextIdentity.Normalize(title);
        var messageIdSource = $"{normalizedTitle}\n{text}\n{sourceFingerprint}";
        var messageId = "screen:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(messageIdSource))).ToLowerInvariant();
        return new ParsedConversation(messageId, normalizedTitle.Length > 0 ? normalizedTitle : fallbackId, title.Trim(), text, group);
    }

    static List<ScreenSession> ReadSessions(Bitmap bitmap, OcrSnapshot snapshot, ScreenLayout layout)
    {
        var result = new List<ScreenSession>();
        for (var index = 0; index < layout.RowCount; index++)
        {
            var top = layout.RowTop + index * layout.RowHeight;
            if (top + layout.RowHeight > bitmap.Height) break;
            var lines = snapshot.Lines
                .Where(line => line.Words.Any())
                .Select(line => new PositionedText(line.Text.Trim(), line.Words.Min(x => x.X), line.Words.Min(x => x.Y), line.Words.Max(x => x.X + x.Width), line.Words.Max(x => x.Y + x.Height)))
                .Where(line => line.Left >= layout.TextLeft && line.Left < layout.ListBounds.Right)
                .Where(line => line.Top >= top + layout.RowHeight * .18 && line.Top < top + layout.RowHeight * .67)
                .OrderBy(line => line.Top)
                .ThenBy(line => line.Left)
                .ToList();
            var name = lines.Select(x => x.Text).FirstOrDefault(x => TextIdentity.Normalize(x).Length > 0);
            if (string.IsNullOrWhiteSpace(name)) continue;
            var key = TextIdentity.Normalize(name);
            if (key.Length == 0) continue;
            var rowBounds = Rectangle.FromLTRB(layout.ListBounds.Left, top, layout.ListBounds.Right, top + layout.RowHeight);
            var unreadBounds = new Rectangle(layout.UnreadLeft, top, layout.UnreadWidth, layout.RowHeight / 2);
            var redPixels = CountUnreadPixels(bitmap, unreadBounds);
            result.Add(new ScreenSession(index, name.Trim(), key, top + layout.RowHeight / 2, redPixels >= layout.UnreadPixelThreshold, redPixels, HashRegion(bitmap, rowBounds)));
        }
        return result;
    }

    static bool IsReliableSessionName(string value)
    {
        var compact = value.Replace(" ", string.Empty);
        var normalized = TextIdentity.Normalize(compact);
        if (normalized.Length < 2 || normalized.All(char.IsDigit)) return false;
        if (compact.StartsWith("[") || compact.StartsWith("【"))
        {
            var previewWords = new[] { "动画", "表情", "图片", "语音", "文件", "链接", "视频", "位置" };
            if (previewWords.Any(compact.Contains)) return false;
        }
        if (Regex.IsMatch(compact, @"^\d{1,2}[:/\-]\d{1,2}")) return false;
        return true;
    }

    static bool LooksLikeGroup(string title)
    {
        var compact = title.Replace(" ", "");
        return Regex.IsMatch(compact, @"[（(]\s*\d{2,}\s*[）)]") || compact.Contains("群聊", StringComparison.Ordinal);
    }

    static int CountUnreadPixels(Bitmap bitmap, Rectangle area)
    {
        var safe = Rectangle.Intersect(new Rectangle(0, 0, bitmap.Width, bitmap.Height), area);
        var count = 0;
        for (var y = safe.Top; y < safe.Bottom; y++)
        for (var x = safe.Left; x < safe.Right; x++)
        {
            var c = bitmap.GetPixel(x, y);
            if (c.R > 195 && c.G < 140 && c.B < 140 && c.R > c.G * 1.35) count++;
        }
        return count;
    }

    static string HashRegion(Bitmap bitmap, Rectangle area)
    {
        var safe = Rectangle.Intersect(new Rectangle(0, 0, bitmap.Width, bitmap.Height), area);
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        Span<byte> pixel = stackalloc byte[3];
        for (var y = safe.Top; y < safe.Bottom; y += 2)
        for (var x = safe.Left; x < safe.Right; x += 2)
        {
            var c = bitmap.GetPixel(x, y);
            pixel[0] = c.R; pixel[1] = c.G; pixel[2] = c.B;
            hash.AppendData(pixel);
        }
        return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
    }

    async Task<string> SaveTemporaryCaptureAsync(Bitmap bitmap, string name, CancellationToken ct)
    {
        Directory.CreateDirectory(stateDir);
        var path = Path.Combine(stateDir, name);
        await Task.Run(() => bitmap.Save(path, ImageFormat.Png), ct);
        return path;
    }

    ScreenReaderState LoadState()
    {
        try
        {
            if (File.Exists(statePath)) return JsonSerializer.Deserialize<ScreenReaderState>(File.ReadAllText(statePath), JsonOptions) ?? ScreenReaderState.Empty;
        }
        catch { }
        return ScreenReaderState.Empty;
    }

    void SaveState()
    {
        Directory.CreateDirectory(stateDir);
        var temporary = statePath + ".tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(state, JsonOptions));
        File.Move(temporary, statePath, true);
    }

    static void TryDelete(string path) { try { File.Delete(path); } catch { } }
    static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true, PropertyNameCaseInsensitive = true };
}

public sealed record ConversationDiagnostic(ScreenSession Session, string? RecognizedTitle, string? LatestIncomingText, bool IsGroup, bool Passed, string OcrText);
public sealed record ScreenReaderDiagnostic(int Width, int Height, IReadOnlyList<ScreenSession> Sessions, string OcrText);
public sealed record ScreenSession(int Index, string Name, string Key, int CenterY, bool HasUnread, int RedPixels, string RowHash);
sealed record ParsedConversation(string MessageId, string ConversationId, string ConversationName, string Text, bool IsGroup);
sealed record PositionedText(string Text, double Left, double Top, double Right, double Bottom);
sealed record ScreenReaderState(bool Initialized, string ListHash, Dictionary<string, string> SessionHashes)
{
    public static ScreenReaderState Empty => new(false, string.Empty, new Dictionary<string, string>(StringComparer.Ordinal));
}

public readonly record struct ScreenLayout(int Width, int Height, Rectangle ListBounds, Rectangle ChatBounds, int RowTop, int RowHeight, int RowCount, int TextLeft, int UnreadLeft, int UnreadWidth, int UnreadPixelThreshold, int ListCenterX)
{
    public static ScreenLayout From(int width, int height)
    {
        int X(double ratio) => (int)Math.Round(width * ratio);
        int Y(double ratio) => (int)Math.Round(height * ratio);
        var listLeft = X(75d / 894d);
        var listRight = X(377d / 894d);
        var rowTop = Y(98d / 591d);
        var rowHeight = Math.Max(56, Y(81d / 591d));
        var count = Math.Max(1, (height - rowTop) / rowHeight);
        return new ScreenLayout(
            width, height,
            Rectangle.FromLTRB(listLeft, rowTop, listRight, height),
            Rectangle.FromLTRB(listRight, 0, width, height),
            rowTop, rowHeight, count,
            X(150d / 894d), X(126d / 894d), Math.Max(20, X(36d / 894d)),
            Math.Max(12, (int)Math.Round(width * height / (894d * 591d) * 24)),
            (listLeft + listRight) / 2
        );
    }
}

public static class TextIdentity
{
    public static bool Matches(string expected, string actual)
    {
        var e = Normalize(expected);
        var a = Normalize(actual);
        if (e.Length == 0 || a.Length == 0) return false;
        if (a.Contains(e, StringComparison.Ordinal) || e.Contains(a, StringComparison.Ordinal)) return Math.Min(e.Length, a.Length) >= 2;
        var prefix = e.TrimEnd('.', '…');
        if (prefix.Length >= 3 && a.StartsWith(prefix, StringComparison.Ordinal)) return true;
        var distance = Levenshtein(e, a);
        var similarity = 1d - distance / (double)Math.Max(e.Length, a.Length);
        return similarity >= .68;
    }

    public static string Normalize(string value)
    {
        var b = new StringBuilder();
        foreach (var c in value.Normalize(NormalizationForm.FormKC).ToLowerInvariant())
            if (char.IsLetterOrDigit(c) || (c >= '\u3400' && c <= '\u9fff')) b.Append(c);
        return b.ToString();
    }

    static int Levenshtein(string left, string right)
    {
        var previous = Enumerable.Range(0, right.Length + 1).ToArray();
        for (var i = 1; i <= left.Length; i++)
        {
            var current = new int[right.Length + 1]; current[0] = i;
            for (var j = 1; j <= right.Length; j++)
                current[j] = Math.Min(Math.Min(current[j - 1] + 1, previous[j] + 1), previous[j - 1] + (left[i - 1] == right[j - 1] ? 0 : 1));
            previous = current;
        }
        return previous[right.Length];
    }
}

public static class WechatWindow
{
    public static IntPtr Find()
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows((hwnd, _) =>
        {
            if (!IsWindowVisible(hwnd)) return true;
            var cls = GetText(hwnd, GetClassName);
            if (!cls.Equals("Qt51514QWindowIcon", StringComparison.OrdinalIgnoreCase)) return true;
            var title = GetText(hwnd, GetWindowText);
            if (title is "微信" or "Weixin" or "WeChat") { found = hwnd; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static Bitmap Capture(IntPtr hwnd)
    {
        if (!GetWindowRect(hwnd, out var rect) || rect.Width < 600 || rect.Height < 400) throw new InvalidOperationException("微信窗口尺寸异常。");
        var bitmap = new Bitmap(rect.Width, rect.Height, PixelFormat.Format32bppArgb);
        using var graphics = Graphics.FromImage(bitmap);
        var hdc = graphics.GetHdc();
        try
        {
            if (!PrintWindow(hwnd, hdc, 2)) throw new InvalidOperationException("微信后台截图失败。");
        }
        finally { graphics.ReleaseHdc(hdc); }
        return bitmap;
    }

    public static IReadOnlyList<WechatPopup> FindNotificationWindows(IntPtr mainWindow)
    {
        var result = new List<WechatPopup>();
        var processIds = Process.GetProcessesByName("Weixin").Select(x => (uint)x.Id).ToHashSet();
        processIds.UnionWith(Process.GetProcessesByName("WeChat").Select(x => (uint)x.Id));
        EnumWindows((hwnd, _) =>
        {
            if (hwnd == mainWindow || !IsWindowVisible(hwnd) || !GetWindowRect(hwnd, out var rect)) return true;
            GetWindowThreadProcessId(hwnd, out var processId);
            if (!processIds.Contains(processId)) return true;
            if (rect.Width is < 180 or > 700 || rect.Height is < 45 or > 350) return true;
            var cls = GetText(hwnd, GetClassName);
            result.Add(new WechatPopup(hwnd, rect.Width, rect.Height, cls, GetText(hwnd, GetWindowText)));
            return true;
        }, IntPtr.Zero);
        return result;
    }

    public static IntPtr GetForeground() => GetForegroundWindow();
    public static void TryFocus(IntPtr hwnd) { if (IsWindow(hwnd)) SetForegroundWindow(hwnd); }
    public static void FocusAndClick(IntPtr hwnd, int relativeX, int relativeY)
    {
        if (!GetWindowRect(hwnd, out var rect)) throw new InvalidOperationException("无法读取微信窗口位置。");
        ShowWindow(hwnd, 9);
        // Windows normally blocks background processes from stealing focus. A harmless Alt press
        // grants the current interactive process one foreground activation attempt.
        KeybdEvent(0x12, 0, 0, UIntPtr.Zero);
        KeybdEvent(0x12, 0, 0x0002, UIntPtr.Zero);
        SetForegroundWindow(hwnd);
        BringWindowToTop(hwnd);
        Thread.Sleep(180);
        SetCursorPos(rect.Left + relativeX, rect.Top + relativeY);
        var inputs = new[] {
            new INPUT { type = 0, U = new InputUnion { mi = new MOUSEINPUT { dwFlags = 0x0002 } } },
            new INPUT { type = 0, U = new InputUnion { mi = new MOUSEINPUT { dwFlags = 0x0004 } } }
        };
        if (SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>()) != inputs.Length)
            throw new InvalidOperationException("微信会话点击失败。");
    }

    static IntPtr FindRenderChild(IntPtr parent)
    {
        IntPtr found = IntPtr.Zero;
        EnumChildWindows(parent, (hwnd, _) =>
        {
            if (GetText(hwnd, GetClassName).Equals("MMUIRenderSubWindowHW", StringComparison.OrdinalIgnoreCase))
            {
                found = hwnd; return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
    delegate bool EnumChildWindowsProc(IntPtr hwnd, IntPtr lParam);
    delegate int TextGetter(IntPtr hwnd, StringBuilder value, int maxCount);
    static string GetText(IntPtr hwnd, TextGetter getter) { var b = new StringBuilder(512); getter(hwnd, b, b.Capacity); return b.ToString(); }
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumChildWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder value, int maxCount);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder value, int maxCount);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern void keybd_event(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo);
    static void KeybdEvent(byte virtualKey, byte scanCode, uint flags, UIntPtr extraInfo) => keybd_event(virtualKey, scanCode, flags, extraInfo);
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint inputCount, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; public int Width => Right - Left; public int Height => Bottom - Top; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public InputUnion U; }
    [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
}

public sealed record WechatPopup(IntPtr Handle, int Width, int Height, string ClassName, string Title);
