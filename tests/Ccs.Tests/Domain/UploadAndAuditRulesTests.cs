using System.Text;
using Ccs.Domain.Rules;
using Xunit;

namespace Ccs.Tests.Domain;

/// <summary>Security audit M-05 (file content must match the extension) and M-07 (viewers see field names, not values).</summary>
public sealed class UploadAndAuditRulesTests
{
    private static byte[] B(params int[] x) => x.Select(v => (byte)v).ToArray();
    private static readonly byte[] Exe = Encoding.ASCII.GetBytes("MZ\x90\0\x03\0\0\0");

    [Theory]
    [InlineData("pdf", "%PDF-1.7\n")]
    [InlineData("txt", "Hello, this is a note.\r\n")]
    [InlineData("csv", "name,email\nNour,n@x.test\n")]
    public void Real_text_based_files_pass(string ext, string content) =>
        Assert.True(FileSignature.Matches(ext, Encoding.UTF8.GetBytes(content)));

    [Fact]
    public void Real_binary_files_pass()
    {
        Assert.True(FileSignature.Matches("png", B(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0)));
        Assert.True(FileSignature.Matches("jpg", B(0xFF, 0xD8, 0xFF, 0xE0)));
        Assert.True(FileSignature.Matches("docx", B(0x50, 0x4B, 0x03, 0x04, 0x14)));
        Assert.True(FileSignature.Matches("xls", B(0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1)));
        Assert.True(FileSignature.Matches("webp", Encoding.ASCII.GetBytes("RIFF\x10\0\0\0WEBPVP8 ")));
    }

    [Theory]
    [InlineData("pdf")]
    [InlineData("docx")]
    [InlineData("png")]
    [InlineData("txt")]
    [InlineData("jpg")]
    public void A_program_renamed_to_an_allowed_type_is_refused(string ext) =>
        Assert.False(FileSignature.Matches(ext, Exe));

    [Fact]
    public void Empty_content_and_unknown_types_are_refused()
    {
        Assert.False(FileSignature.Matches("pdf", []));
        Assert.False(FileSignature.Matches("exe", Exe));
    }

    [Fact]
    public void Audit_lists_changed_field_names_only()
    {
        var changed = AuditFields.Changed(
            """{"email":"old@x.test","phone":"0100","full_name":"Nour","updated_at":"a"}""",
            """{"email":"new@x.test","phone":"0100","full_name":"Nour","updated_at":"b","status":"active"}""");
        Assert.Equal(["email", "status"], changed.OrderBy(x => x));
    }

    [Fact]
    public void Audit_handles_missing_or_bad_json()
    {
        Assert.Empty(AuditFields.Changed(null, null));
        Assert.Equal(["a"], AuditFields.Changed("not json", """{"a":1}"""));
    }
}
