using System.Diagnostics;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;

namespace TeleOpc.WechatBridge;

public sealed class SafeWechatSender
{
    readonly LocalOcr ocr = new();
    readonly string evidenceDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TeleOpc", "WechatBridge", "verification");

    public async Task<SendResult> SendAsync(OutboxItem item, CancellationToken ct)
    {
        var target = item.conversation_name?.Trim();
        if (string.IsNullOrWhiteSpace(target)) return SendResult.Fail("缺少联系人名称，拒绝发送。", null, null);
        var hwnd = FindWechatWindow();
        if (hwnd == IntPtr.Zero) return SendResult.Fail("没有找到已登录的微信主窗口。", null, null);
        if (!GetWindowRect(hwnd, out var rect) || rect.Width < 600 || rect.Height < 400)
            return SendResult.Fail("微信窗口尺寸异常，拒绝发送。", null, null);

        ShowWindow(hwnd, 9);
        SetForegroundWindow(hwnd);
        await Task.Delay(350, ct);

        KeyChord(VK_CONTROL, (ushort)'F');
        await Task.Delay(250, ct);
        ClipboardSta.SetText(target);
        KeyChord(VK_CONTROL, (ushort)'V');
        await Task.Delay(700, ct);
        KeyPress(VK_RETURN);
        await Task.Delay(900, ct);

        Directory.CreateDirectory(evidenceDir);
        var screenshot = Path.Combine(evidenceDir, "last-contact-check.png");
        CaptureHeader(rect, screenshot);
        string recognized;
        try { recognized = await ocr.RecognizeFileAsync(screenshot); }
        catch (Exception e) { return SendResult.Fail("本地 OCR 校验失败：" + e.Message, screenshot, null); }

        if (!ContactMatches(target, recognized))
            return SendResult.Fail($"联系人校验不一致。目标：{target}；屏幕识别：{Compact(recognized)}", screenshot, recognized);

        // Click the lower-right editor area. Coordinates are relative to the verified WeChat main window.
        var x = rect.Left + (int)(rect.Width * 0.68);
        var y = rect.Top + (int)(rect.Height * 0.84);
        SetCursorPos(x, y);
        MouseClick();
        await Task.Delay(180, ct);
        ClipboardSta.SetText(item.text);
        KeyChord(VK_CONTROL, (ushort)'V');
        await Task.Delay(120, ct);
        KeyPress(VK_RETURN);
        return SendResult.Ok(screenshot, recognized);
    }

    static IntPtr FindWechatWindow()
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

    static void CaptureHeader(RECT rect, string path)
    {
        var leftOffset = Math.Max(280, (int)(rect.Width * 0.25));
        var width = Math.Max(250, rect.Width - leftOffset - 80);
        var height = Math.Clamp((int)(rect.Height * 0.13), 70, 110);
        using var bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb);
        using var graphics = Graphics.FromImage(bitmap);
        graphics.CopyFromScreen(rect.Left + leftOffset, rect.Top, 0, 0, bitmap.Size, CopyPixelOperation.SourceCopy);
        bitmap.Save(path, ImageFormat.Png);
    }

    static bool ContactMatches(string expected, string actual)
    {
        var e = Normalize(expected);
        var a = Normalize(actual);
        return e.Length >= 2 && a.Contains(e, StringComparison.Ordinal);
    }
    static string Normalize(string value)
    {
        var b = new StringBuilder();
        foreach (var c in value.Normalize(NormalizationForm.FormKC).ToLowerInvariant())
            if (char.IsLetterOrDigit(c) || (c >= '\u3400' && c <= '\u9fff')) b.Append(c);
        return b.ToString();
    }
    static string Compact(string value) => value.Replace("\r", " ").Replace("\n", " ").Trim();

    static void KeyChord(ushort modifier, ushort key) { KeyDown(modifier); KeyPress(key); KeyUp(modifier); }
    static void KeyPress(ushort key) { KeyDown(key); KeyUp(key); }
    static void KeyDown(ushort key) => SendKey(key, 0);
    static void KeyUp(ushort key) => SendKey(key, KEYEVENTF_KEYUP);
    static void SendKey(ushort key, uint flags)
    {
        var input = new INPUT { type = 1, U = new InputUnion { ki = new KEYBDINPUT { wVk = key, dwFlags = flags } } };
        if (SendInput(1, new[] { input }, Marshal.SizeOf<INPUT>()) != 1) throw new InvalidOperationException("键盘输入失败。");
    }
    static void MouseClick()
    {
        var inputs = new[] {
            new INPUT { type = 0, U = new InputUnion { mi = new MOUSEINPUT { dwFlags = 0x0002 } } },
            new INPUT { type = 0, U = new InputUnion { mi = new MOUSEINPUT { dwFlags = 0x0004 } } }
        };
        SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());
    }
    delegate int TextGetter(IntPtr hwnd, StringBuilder value, int maxCount);
    static string GetText(IntPtr hwnd, TextGetter getter) { var b = new StringBuilder(512); getter(hwnd, b, b.Capacity); return b.ToString(); }

    const ushort VK_CONTROL = 0x11, VK_RETURN = 0x0D;
    const uint KEYEVENTF_KEYUP = 0x0002;
    delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder value, int maxCount);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder value, int maxCount);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint inputCount, INPUT[] inputs, int size);
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; public int Width => Right - Left; public int Height => Bottom - Top; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public InputUnion U; }
    [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
}

public sealed record SendResult(bool Sent, string? Error, string? ScreenshotPath, string? RecognizedText)
{
    public static SendResult Ok(string screenshot, string recognized) => new(true, null, screenshot, recognized);
    public static SendResult Fail(string error, string? screenshot, string? recognized) => new(false, error, screenshot, recognized);
}

static class ClipboardSta
{
    public static void SetText(string text)
    {
        Exception? error = null;
        var thread = new Thread(() => { try { Clipboard.SetText(text); } catch (Exception e) { error = e; } });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start(); thread.Join();
        if (error is not null) throw new InvalidOperationException("无法写入剪贴板。", error);
    }
}
