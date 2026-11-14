namespace Ccs.Domain.Rules;

/// <summary>
/// Checks that an uploaded file's first bytes match its extension (security audit M-05), so a program or
/// script cannot be uploaded under an allowed name such as "invoice.pdf".
/// </summary>
public static class FileSignature
{
    private static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    private static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF];
    private static readonly byte[] Gif = "GIF8"u8.ToArray();
    private static readonly byte[] Riff = "RIFF"u8.ToArray();
    private static readonly byte[] Webp = "WEBP"u8.ToArray();
    private static readonly byte[] Pdf = "%PDF-"u8.ToArray();
    private static readonly byte[] Zip = [0x50, 0x4B, 0x03, 0x04];
    private static readonly byte[] ZipEmpty = [0x50, 0x4B, 0x05, 0x06];
    private static readonly byte[] Ole = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];   // old Office (.doc, .xls, .ppt)

    /// <summary>How many leading bytes <see cref="Matches"/> needs.</summary>
    public const int HeadLength = 4096;

    public static bool Matches(string ext, ReadOnlySpan<byte> head) => ext switch
    {
        "png" => head.StartsWith(Png),
        "jpg" or "jpeg" => head.StartsWith(Jpeg),
        "gif" => head.StartsWith(Gif),
        "webp" => head.StartsWith(Riff) && head.Length >= 12 && head[8..12].SequenceEqual(Webp),
        "pdf" => head.StartsWith(Pdf),
        "docx" or "xlsx" or "pptx" or "zip" => head.StartsWith(Zip) || head.StartsWith(ZipEmpty),
        "doc" or "xls" or "ppt" => head.StartsWith(Ole),
        "txt" or "csv" => IsText(head),
        _ => false,
    };

    /// <summary>Plain text: no NUL bytes and not a Windows program ("MZ").</summary>
    private static bool IsText(ReadOnlySpan<byte> head) => !head.StartsWith("MZ"u8) && !head.Contains((byte)0);
}
