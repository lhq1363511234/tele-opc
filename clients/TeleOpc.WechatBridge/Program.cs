using System.Text.Json;

namespace TeleOpc.WechatBridge;
internal static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        if (args.Length == 3 && args[0].Equals("--conversation-diagnose", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                new WechatScreenReader().DiagnoseConversationAsync(int.Parse(args[1]), args[2]).GetAwaiter().GetResult();
                Environment.ExitCode = 0;
            }
            catch (Exception e)
            {
                Directory.CreateDirectory(args[2]);
                File.WriteAllText(Path.Combine(args[2], "conversation-error.txt"), e.ToString());
                Environment.ExitCode = 1;
            }
            return;
        }
        if (args.Length == 2 && args[0].Equals("--screen-diagnose", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                new WechatScreenReader().DiagnoseAsync(args[1]).GetAwaiter().GetResult();
                Environment.ExitCode = 0;
            }
            catch (Exception e)
            {
                Directory.CreateDirectory(args[1]);
                File.WriteAllText(Path.Combine(args[1], "wechat-screen-error.txt"), e.ToString());
                Environment.ExitCode = 1;
            }
            return;
        }
        if (args.Length == 3 && args[0].Equals("--ocr-layout", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                var result = new LocalOcr().RecognizeLayoutAsync(args[1]).GetAwaiter().GetResult();
                File.WriteAllText(args[2], JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));
                Environment.ExitCode = 0;
            }
            catch (Exception e)
            {
                File.WriteAllText(args[2], JsonSerializer.Serialize(new { error = e.ToString() }, new JsonSerializerOptions { WriteIndented = true }));
                Environment.ExitCode = 1;
            }
            return;
        }
        Application.SetHighDpiMode(HighDpiMode.DpiUnaware);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new MainForm());
    }
}
