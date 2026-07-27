using Windows.Globalization;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage;
using System.Runtime.InteropServices.WindowsRuntime;

namespace TeleOpc.WechatBridge;

public sealed class LocalOcr
{
    public async Task<string> RecognizeFileAsync(string path) => (await RecognizeLayoutAsync(path)).Text;

    public async Task<OcrSnapshot> RecognizeLayoutAsync(string path)
    {
        var file = await StorageFile.GetFileFromPathAsync(Path.GetFullPath(path)).AsTask();
        using var stream = await file.OpenAsync(FileAccessMode.Read).AsTask();
        var decoder = await BitmapDecoder.CreateAsync(stream).AsTask();
        using var bitmap = await decoder.GetSoftwareBitmapAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied).AsTask();
        var engine = OcrEngine.TryCreateFromLanguage(new Language("zh-Hans"))
                     ?? OcrEngine.TryCreateFromUserProfileLanguages()
                     ?? throw new InvalidOperationException("Windows 本地 OCR 不可用，请安装中文语言包。");
        var result = await engine.RecognizeAsync(bitmap).AsTask();
        var lines = result.Lines.Select((line, lineIndex) => new OcrLineResult(
            lineIndex,
            line.Text ?? string.Empty,
            line.Words.Select(word => new OcrWordResult(
                word.Text ?? string.Empty,
                word.BoundingRect.X,
                word.BoundingRect.Y,
                word.BoundingRect.Width,
                word.BoundingRect.Height
            )).ToList()
        )).ToList();
        return new OcrSnapshot(result.Text ?? string.Empty, bitmap.PixelWidth, bitmap.PixelHeight, lines);
    }
}

public sealed record OcrSnapshot(string Text, int Width, int Height, IReadOnlyList<OcrLineResult> Lines);
public sealed record OcrLineResult(int Index, string Text, IReadOnlyList<OcrWordResult> Words);
public sealed record OcrWordResult(string Text, double X, double Y, double Width, double Height);
