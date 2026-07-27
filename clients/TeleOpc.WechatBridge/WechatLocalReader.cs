using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace TeleOpc.WechatBridge;

public sealed class WechatLocalReader
{
    readonly string python;
    readonly string moduleRoot;
    readonly string stateRoot;

    public WechatLocalReader()
    {
        python = Path.Combine(AppContext.BaseDirectory, "tools", "python", "python.exe");
        moduleRoot = Path.Combine(AppContext.BaseDirectory, "tools", "wechat-cli");
        stateRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TeleOpc", "WechatBridge", "local-reader");
    }

    public bool IsBundled => File.Exists(python) && Directory.Exists(Path.Combine(moduleRoot, "wechat_cli"));
    public bool IsInitialized => File.Exists(Path.Combine(stateRoot, ".wechat-cli", "config.json")) && File.Exists(Path.Combine(stateRoot, ".wechat-cli", "all_keys.json"));

    public async Task<IReadOnlyList<WechatInbound>> ReadNewAsync(CancellationToken ct)
    {
        if (!IsBundled) throw new InvalidOperationException("本地消息读取组件未安装，请下载完整安装包。");
        if (!IsInitialized) throw new InvalidOperationException("本地消息读取尚未初始化，请点击“初始化消息读取”。");
        var result = await RunAsync(["-c", PythonBootstrap(), "new-messages", "--format", "json"], ct);
        if (result.ExitCode != 0) throw new InvalidOperationException(CleanError(result.Error, result.Output));
        using var doc = JsonDocument.Parse(ExtractJson(result.Output));
        var list = new List<WechatInbound>();
        if (!doc.RootElement.TryGetProperty("messages", out var messages) || messages.ValueKind != JsonValueKind.Array) return list;
        foreach (var m in messages.EnumerateArray())
        {
            var direction = GetString(m, "direction");
            var unread = GetInt(m, "unread");
            // Safety first: never upload a known outbound message. Unknown messages require an unread signal.
            if (direction == "outbound" || (direction != "inbound" && unread <= 0)) continue;
            var text = GetString(m, "last_message").Trim();
            var username = GetString(m, "username").Trim();
            if (text.Length == 0 || username.Length == 0) continue;
            var timestamp = GetLong(m, "timestamp");
            var messageId = GetString(m, "message_id");
            if (messageId.Length == 0) messageId = $"{username}:{timestamp}";
            list.Add(new WechatInbound(
                messageId,
                username,
                GetString(m, "chat"),
                text,
                GetBool(m, "is_group"),
                timestamp > 0 ? DateTimeOffset.FromUnixTimeSeconds(timestamp).ToString("O") : DateTimeOffset.UtcNow.ToString("O")
            ));
        }
        return list;
    }

    public void StartInitialization()
    {
        if (!IsBundled) throw new InvalidOperationException("本地消息读取组件未安装，请下载完整安装包。");
        Directory.CreateDirectory(stateRoot);
        var cmdPath = Path.Combine(stateRoot, "initialize-wechat-reader.cmd");
        var bootstrap = PythonBootstrap().Replace("\"", "\\\"");
        var script = $"@echo off\r\nchcp 65001>nul\r\nset \"HOME={QuoteForSet(stateRoot)}\"\r\nset \"USERPROFILE={QuoteForSet(stateRoot)}\"\r\n\"{python}\" -c \"{bootstrap}\" --version\r\nif errorlevel 1 (echo. & echo [ERROR] 内置消息读取模块加载失败。 & pause & exit /b 1)\r\n\"{python}\" -c \"{bootstrap}\" init --force\r\nif errorlevel 1 (echo. & echo [ERROR] 初始化失败，请把本窗口最后几行发给智能体。 & pause & exit /b 1)\r\necho.\r\necho 初始化完成，窗口可以关闭了。\r\npause\r\n";
        File.WriteAllText(cmdPath, script, new UTF8Encoding(false));
        Process.Start(new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = $"/c \"\"{cmdPath}\"\"",
            WorkingDirectory = stateRoot,
            UseShellExecute = true,
            Verb = "runas"
        });
    }

    async Task<ProcessResult> RunAsync(IReadOnlyList<string> arguments, CancellationToken ct)
    {
        Directory.CreateDirectory(stateRoot);
        using var process = new Process();
        process.StartInfo = new ProcessStartInfo
        {
            FileName = python,
            WorkingDirectory = stateRoot,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
            CreateNoWindow = true
        };
        foreach (var argument in arguments) process.StartInfo.ArgumentList.Add(argument);
        process.StartInfo.Environment["HOME"] = stateRoot;
        process.StartInfo.Environment["USERPROFILE"] = stateRoot;
        process.StartInfo.Environment["PYTHONPATH"] = moduleRoot;
        process.Start();
        var stdout = process.StandardOutput.ReadToEndAsync(ct);
        var stderr = process.StandardError.ReadToEndAsync(ct);
        await process.WaitForExitAsync(ct);
        return new ProcessResult(process.ExitCode, await stdout, await stderr);
    }

    static string PythonBootstrap() => "import os,sys;sys.path.insert(0,os.path.abspath(os.path.join(os.path.dirname(sys.executable),'..','wechat-cli')));from wechat_cli.main import cli;cli()";

    static string ExtractJson(string output)
    {
        var start = output.IndexOf('{');
        var end = output.LastIndexOf('}');
        if (start < 0 || end < start) throw new InvalidOperationException("本地消息读取器未返回 JSON。" + CleanError(output, ""));
        return output[start..(end + 1)];
    }
    static string CleanError(string a, string b) => string.Join(" ", new[] { a, b }.Where(x => !string.IsNullOrWhiteSpace(x))).Trim().Replace("\r", " ").Replace("\n", " ");
    static string QuoteForSet(string value) => value.Replace("%", "%%");
    static string GetString(JsonElement e, string name) => e.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() ?? "" : "";
    static bool GetBool(JsonElement e, string name) => e.TryGetProperty(name, out var p) && p.ValueKind is JsonValueKind.True or JsonValueKind.False && p.GetBoolean();
    static int GetInt(JsonElement e, string name) => e.TryGetProperty(name, out var p) && p.TryGetInt32(out var v) ? v : 0;
    static long GetLong(JsonElement e, string name) => e.TryGetProperty(name, out var p) && p.TryGetInt64(out var v) ? v : 0;
    sealed record ProcessResult(int ExitCode, string Output, string Error);
}
