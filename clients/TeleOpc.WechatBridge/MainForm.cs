namespace TeleOpc.WechatBridge;

public sealed class MainForm : Form
{
    readonly NotifyIcon tray = new() { Icon = SystemIcons.Application, Text = "Tele-OPC 微信桥接", Visible = true };
    readonly BridgeSettings settings = BridgeSettings.Load();
    readonly WechatLocalReader localReader = new();
    readonly WechatScreenReader screenReader = new();
    readonly SafeWechatSender safeSender = new();
    readonly TextBox server = new() { Width = 360 };
    readonly TextBox token = new() { Width = 360, UseSystemPasswordChar = true };
    readonly CheckBox auto = new() { Text = "自动回复" };
    readonly CheckBox groups = new() { Text = "处理群聊" };
    readonly NumericUpDown interval = new() { Minimum = 2, Maximum = 60 };
    readonly Button toggle = new() { Text = "启动", Width = 100 };
    readonly Button initialize = new() { Text = "尝试数据库读取（可选）", Width = 170 };
    readonly Button diagnose = new() { Text = "导出微信诊断", Width = 130 };
    readonly Label mode = new() { AutoSize = true };
    readonly TextBox log = new() { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Dock = DockStyle.Fill };
    CancellationTokenSource? cts;
    WechatAutomation? wechat;

    public MainForm()
    {
        Text = "Tele-OPC 个人微信桥接";
        Width = 680;
        Height = 540;
        server.Text = settings.ServerUrl;
        token.Text = settings.DeviceToken;
        auto.Checked = settings.AutoReply;
        groups.Checked = settings.Groups;
        interval.Value = Math.Clamp(settings.PollSeconds, 2, 60);
        var top = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 180, Padding = new Padding(10) };
        top.Controls.AddRange([
            new Label { Text = "服务器", Width = 80 }, server,
            new Label { Text = "设备令牌", Width = 80 }, token,
            auto, groups, new Label { Text = "轮询秒数" }, interval,
            toggle, initialize, diagnose, mode
        ]);
        Controls.Add(log);
        Controls.Add(top);
        toggle.Click += async (_, _) => await Toggle();
        initialize.Click += (_, _) => InitializeReader();
        diagnose.Click += (_, _) => RunDiagnose();
        auto.CheckedChanged += (_, _) => { settings.AutoReply = auto.Checked; settings.Save(); Write($"自动回复已{(auto.Checked ? "开启" : "关闭")}。"); };
        groups.CheckedChanged += (_, _) => { settings.Groups = groups.Checked; settings.Save(); Write($"群聊处理已{(groups.Checked ? "开启" : "关闭")}。"); };
        interval.ValueChanged += (_, _) => { settings.PollSeconds = (int)interval.Value; settings.Save(); };
        FormClosing += (_, _) => { cts?.Cancel(); wechat?.Dispose(); tray.Visible = false; };
        Resize += (_, _) =>
        {
            if (WindowState == FormWindowState.Minimized)
            {
                Hide();
                tray.ShowBalloonTip(1000, "Tele-OPC 微信桥接", "客户端仍在后台运行", ToolTipIcon.Info);
            }
        };
        tray.DoubleClick += (_, _) => Restore();
        var menu = new ContextMenuStrip();
        menu.Items.Add("打开", null, (_, _) => Restore());
        menu.Items.Add("暂停", null, (_, _) => cts?.Cancel());
        menu.Items.Add("退出", null, (_, _) => Close());
        tray.ContextMenuStrip = menu;
        Shown += async (_, _) =>
        {
            if (cts is null && !string.IsNullOrWhiteSpace(token.Text)) await Toggle();
        };
        screenReader.Log = Write;
        RefreshModeLabel();
        Write(localReader.IsInitialized ? "数据库读取可用；将优先使用数据库。" : "屏幕识别模式已就绪；首次启动只建立基线，不处理已有未读消息。");
    }

    async Task Toggle()
    {
        if (cts is not null)
        {
            cts.Cancel();
            cts = null;
            toggle.Text = "启动";
            Write("桥接已暂停。");
            return;
        }
        settings.ServerUrl = server.Text.Trim();
        settings.DeviceToken = token.Text.Trim();
        settings.AutoReply = auto.Checked;
        settings.Groups = groups.Checked;
        settings.PollSeconds = (int)interval.Value;
        settings.Save();
        cts = new CancellationTokenSource();
        toggle.Text = "暂停";
        Write($"桥接已启动：{(localReader.IsInitialized ? "数据库读取" : screenReader.ModeDescription)}；发送前 OCR 校验；自动回复={(settings.AutoReply ? "开启" : "关闭")}。");
        try { await Task.Run(() => Loop(cts.Token)); }
        catch (OperationCanceledException) { }
        finally
        {
            if (!IsDisposed) BeginInvoke(() => { if (cts?.IsCancellationRequested == true) { cts = null; toggle.Text = "启动"; } });
        }
    }

    async Task Loop(CancellationToken ct)
    {
        var api = new BridgeApiClient(settings);
        string? previousError = null;
        while (!ct.IsCancellationRequested)
        {
            string? heartbeatError = null;
            try
            {
                var messages = localReader.IsInitialized
                    ? await localReader.ReadNewAsync(ct)
                    : await screenReader.ReadNewAsync(settings.Groups, ct);
                foreach (var msg in messages)
                {
                    if (msg.isGroup && !settings.Groups) continue;
                    await api.UploadAsync(msg, ct);
                    Write($"已接收：{msg.conversationName ?? msg.conversationId}：{Preview(msg.text)}");
                }
                if (settings.AutoReply)
                {
                    foreach (var item in await api.ClaimAsync(ct))
                    {
                        SendResult result;
                        try { result = await safeSender.SendAsync(item, ct); }
                        catch (Exception e) { result = SendResult.Fail(e.Message, null, null); }
                        await api.AckAsync(item, result.Sent, result.Error, ct);
                        Write(result.Sent
                            ? $"已安全回复：{item.conversation_name ?? item.conversation_id}（OCR 已校验）"
                            : $"已拦截发送：{item.conversation_name ?? item.conversation_id}；{result.Error}");
                    }
                }
                previousError = null;
            }
            catch (Exception e)
            {
                heartbeatError = e.Message;
                if (!string.Equals(previousError, e.Message, StringComparison.Ordinal)) Write("运行异常：" + e.Message);
                previousError = e.Message;
            }
            try { await api.HeartbeatAsync(heartbeatError, ct); }
            catch (Exception e)
            {
                if (!string.Equals(previousError, e.Message, StringComparison.Ordinal)) Write("服务器连接异常：" + e.Message);
                previousError = e.Message;
            }
            await Task.Delay(TimeSpan.FromSeconds(settings.PollSeconds), ct);
        }
    }

    void InitializeReader()
    {
        try
        {
            localReader.StartInitialization();
            Write("已打开可选的数据库读取初始化。当前微信版本若提取不到密钥，可直接关闭窗口，屏幕识别仍可正常使用。");
        }
        catch (Exception e) { Write("初始化启动失败：" + e.Message); }
    }

    void RunDiagnose()
    {
        try
        {
            wechat?.Dispose();
            wechat = new WechatAutomation();
            if (!wechat.Connect()) { Write("未找到微信进程。"); return; }
            Write("诊断文件：" + wechat.Diagnose());
        }
        catch (Exception e) { Write(e.Message); }
    }

    void RefreshModeLabel()
    {
        mode.Text = localReader.IsInitialized
            ? "模式：数据库读取 + 发送前 OCR 校验"
            : "模式：微信 4.1 后台截图 + Windows 本地 OCR";
    }
    void Restore() { Show(); WindowState = FormWindowState.Normal; Activate(); RefreshModeLabel(); }
    static string Preview(string text) => text.Length <= 40 ? text : text[..40] + "…";
    void Write(string value)
    {
        if (InvokeRequired) { BeginInvoke(() => Write(value)); return; }
        var line = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {value}";
        log.AppendText(line + "\r\n");
        try
        {
            var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TeleOpc", "WechatBridge");
            Directory.CreateDirectory(directory);
            File.AppendAllText(Path.Combine(directory, "bridge.log"), line + Environment.NewLine);
        }
        catch { }
        RefreshModeLabel();
    }
}
