using Windows.Globalization;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage;
using System.Runtime.InteropServices.WindowsRuntime;

namespace TeleOpc.WechatBridge;

public sealed class LocalOcr
{
    public async Task<string> RecognizeFileAsync(string path)
    {
        var file = await StorageFile.GetFileFromPathAsync(path).AsTask();
        using var stream = await file.OpenAsync(FileAccessMode.Read).AsTask();
        var decoder = await BitmapDecoder.CreateAsync(stream).AsTask();
        using var bitmap = await decoder.GetSoftwareBitmapAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied).AsTask();
        var engine = OcrEngine.TryCreateFromLanguage(new Language("zh-Hans"))
                     ?? OcrEngine.TryCreateFromUserProfileLanguages()
                     ?? throw new InvalidOperationException("Windows 本地 OCR 不可用，请安装中文语言包。");
        var result = await engine.RecognizeAsync(bitmap).AsTask();
        return result.Text ?? string.Empty;
    }
}
