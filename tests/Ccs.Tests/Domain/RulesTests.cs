using System.Text.Json;
using Ccs.Application.Common;
using Ccs.Application.Tickets;
using Ccs.Domain.Entities;
using Ccs.Domain.Rules;
using Ccs.Infrastructure.Email;
using Ccs.Infrastructure.Identity;
using Microsoft.AspNetCore.Identity;

namespace Ccs.Tests.Domain;

public class RulesTests
{
    [Theory]
    [InlineData("01012345678", "+201012345678")]
    [InlineData("+201012345678", "+201012345678")]
    [InlineData("201012345678", "+201012345678")]
    [InlineData("010 1234 5678", "+201012345678")]
    [InlineData("0101234567", null)]
    [InlineData("+441012345678", null)]
    [InlineData("someone@example.com", null)]
    public void Egyptian_phone_numbers(string input, string? expected) => Assert.Equal(expected, EgyptPhone.Normalize(input));

    [Fact]
    public void Password_policy_defaults_need_10_chars_upper_lower_number_special()
    {
        var p = new PasswordPolicy();
        Assert.Empty(p.Check("Str0ng!Pass"));
        Assert.Equal(new[] { "min_length", "upper", "number", "special" }, p.Check("weak"));
    }

    [Fact]
    public void Password_expiry_warns_at_7_4_1_days()
    {
        var p = new PasswordPolicy(ExpiryEnabled: true, ExpiryDays: 90);
        var changed = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);
        Assert.Equal(0, p.Stage(changed, changed.AddDays(80)));
        Assert.Equal(1, p.Stage(changed, changed.AddDays(84)));
        Assert.Equal(2, p.Stage(changed, changed.AddDays(87)));
        Assert.Equal(3, p.Stage(changed, changed.AddDays(89.5)));
        Assert.Equal(4, p.Stage(changed, changed.AddDays(91)));
        Assert.Equal(0, new PasswordPolicy().Stage(changed, changed.AddDays(200)));   // off by default
    }

    [Fact]
    public void Ticket_reference_format() => Assert.Equal("CTS-2026-000073", TicketReference.Format(2026, 73));

    [Theory]
    [InlineData("https://example.com/a", true)]
    [InlineData("/en/tickets", true)]
    [InlineData("mailto:help@example.com", true)]
    [InlineData("tel:+20 100 000", true)]
    [InlineData("javascript:alert(1)", false)]
    [InlineData("//evil.example.com", false)]
    [InlineData("http://plain.example.com", false)]
    public void Only_https_mailto_tel_and_site_paths_are_allowed(string href, bool ok) => Assert.Equal(ok, SafeLink.IsAllowed(href));

    [Fact]
    public void Email_markdown_never_inserts_raw_html()
    {
        var html = EmailRenderer.MarkdownToHtml("**Hi** <script>x</script> [go](javascript:alert(1)) [ok](https://a.example)", "#1f64e6");
        Assert.Contains("<strong>Hi</strong>", html);
        Assert.Contains("&lt;script&gt;", html);
        Assert.DoesNotContain("javascript:", html);
        Assert.Contains("href=\"https://a.example\"", html);
    }

    [Fact]
    public void Placeholders_are_filled_and_unknown_ones_left()
    {
        var s = EmailRenderer.Fill("{name} - {reference} - {other}", new Dictionary<string, string> { ["name"] = "Mona", ["reference"] = "CTS-1" });
        Assert.Equal("Mona - CTS-1 - {other}", s);
    }

    [Fact]
    public void Migrated_bcrypt_passwords_verify_and_ask_for_rehash()
    {
        var hasher = new BcryptCompatiblePasswordHasher();
        var supabaseHash = BCrypt.Net.BCrypt.HashPassword("Old-Pass-2024!", workFactor: 10);
        Assert.Equal(PasswordVerificationResult.SuccessRehashNeeded, hasher.VerifyHashedPassword(new AppUser(), supabaseHash, "Old-Pass-2024!"));
        Assert.Equal(PasswordVerificationResult.Failed, hasher.VerifyHashedPassword(new AppUser(), supabaseHash, "wrong"));
        var identityHash = hasher.HashPassword(new AppUser(), "New-Pass-2026!");
        Assert.Equal(PasswordVerificationResult.Success, hasher.VerifyHashedPassword(new AppUser(), identityHash, "New-Pass-2026!"));
    }

    static CustomFieldDefinition Field(string type, string options = "[]", string validation = "{}") =>
        new() { Key = "f1", Type = type, Options = options, Validation = validation };

    static JsonElement J(string json) => JsonDocument.Parse(json).RootElement;

    [Fact]
    public void Custom_fields_are_validated_by_type_range_length_pattern_and_choices()
    {
        Assert.Equal("5", CustomFieldValidator.Validate(Field("number", validation: """{"min":1,"max":10}"""), J("5")));
        Assert.Throws<ValidationFailedException>(() => CustomFieldValidator.Validate(Field("number", validation: """{"max":10}"""), J("11")));
        Assert.Throws<ValidationFailedException>(() => CustomFieldValidator.Validate(Field("text", validation: """{"max_length":3}"""), J("\"abcd\"")));
        Assert.Throws<ValidationFailedException>(() => CustomFieldValidator.Validate(Field("text", validation: """{"pattern":"^[0-9]+$"}"""), J("\"12a\"")));
        Assert.Throws<ValidationFailedException>(() => CustomFieldValidator.Validate(Field("dropdown", """["a","b"]"""), J("\"c\"")));
        CustomFieldValidator.Validate(Field("multi_select", """[{"value":"a"},{"value":"b"}]"""), J("""["a","b"]"""));
        Assert.Throws<ValidationFailedException>(() => CustomFieldValidator.Validate(Field("date"), J("\"09/11/2026\"")));
        Assert.True(CustomFieldValidator.IsEmpty(J("\"  \"")));
    }
}
