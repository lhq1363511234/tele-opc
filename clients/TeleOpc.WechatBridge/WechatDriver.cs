namespace TeleOpc.WechatBridge;

/// <summary>
/// Single entry point for reading personal WeChat messages. The UI and bridge loop do not
/// need to know whether messages came from the optional local reader or the safe screen reader.
/// </summary>
public sealed class WechatDriver
{
    readonly WechatLocalReader localReader;
    readonly WechatScreenReader screenReader;
    string? lastAvailabilityMessage;

    public WechatDriver(WechatLocalReader localReader, WechatScreenReader screenReader)
    {
        this.localReader = localReader;
        this.screenReader = screenReader;
    }

    public Action<string>? Log { get; set; }

    public string ModeDescription => localReader.IsInitialized
        ? "本地消息读取"
        : "微信 4.1 兼容模式";

    public string ReadyDescription => localReader.IsInitialized
        ? "消息驱动已就绪。"
        : "微信兼容驱动已就绪；首次启动只建立基线，不处理已有未读消息。";

    public async Task<IReadOnlyList<WechatInbound>> ReadNewAsync(bool allowGroups, CancellationToken ct)
    {
        if (localReader.IsInitialized)
        {
            lastAvailabilityMessage = null;
            return await localReader.ReadNewAsync(ct);
        }

        try
        {
            var messages = await screenReader.ReadNewAsync(allowGroups, ct);
            if (lastAvailabilityMessage is not null)
            {
                Log?.Invoke("微信主界面已恢复，消息监听继续运行。");
                lastAvailabilityMessage = null;
            }
            return messages;
        }
        catch (WechatWindowUnavailableException e)
        {
            // Closing WeChat to the tray destroys/hides its render window on some 4.1 builds.
            // This is a waiting state, not a bridge/server failure.
            if (!string.Equals(lastAvailabilityMessage, e.Message, StringComparison.Ordinal))
            {
                Log?.Invoke(e.Message);
                lastAvailabilityMessage = e.Message;
            }
            return Array.Empty<WechatInbound>();
        }
    }
}
