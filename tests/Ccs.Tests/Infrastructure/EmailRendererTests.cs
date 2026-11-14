using Ccs.Infrastructure.Email;
using Xunit;

namespace Ccs.Tests.Infrastructure;

/// <summary>Security audit M-03: values typed by people must never become links or formatting in system emails.</summary>
public sealed class EmailRendererTests
{
    private static readonly EmailDesign Design = new("#0b1a3a", "#1f64e6", "#f0f4fb", null, true, true, false);

    private static RenderedEmail Render(string body, Dictionary<string, string> values) =>
        EmailRenderer.Render("New ticket {reference}", body, "Open", "https://ccs.example/tickets/1", values, Design, "CCS", "en", null);

    [Fact]
    public void A_link_typed_into_a_value_is_not_rendered_as_a_link()
    {
        var html = Render("Ticket from {customer}: {subject}", new()
        {
            ["customer"] = "Nour", ["reference"] = "CTS-1",
            ["subject"] = "[Reset your password](https://evil.example/login)",
        }).Html;
        Assert.DoesNotContain("href=\"https://evil.example", html);
        Assert.Contains("Reset your password", html);   // the text itself is still shown
    }

    [Fact]
    public void Bold_and_italic_typed_into_a_value_are_not_rendered()
    {
        var html = Render("Hello {name}", new() { ["name"] = "**URGENT** *act now*" }).Html;
        Assert.DoesNotContain("<strong>", html);
        Assert.DoesNotContain("<em>", html);
    }

    [Fact]
    public void A_link_split_across_two_values_does_not_form()
    {
        var html = Render("{name} {subject}", new() { ["name"] = "[Click here", ["subject"] = "](https://evil.example)" }).Html;
        Assert.DoesNotContain("href=\"https://evil.example", html);
    }

    [Fact]
    public void Links_written_in_the_template_by_an_administrator_still_work()
    {
        var html = Render("See [our help center](https://ccs.example/kb) about {subject}", new() { ["subject"] = "login" }).Html;
        Assert.Contains("href=\"https://ccs.example/kb\"", html);
    }

    [Fact]
    public void Html_in_a_value_stays_encoded()
    {
        var html = Render("{subject}", new() { ["subject"] = "<script>alert(1)</script>" }).Html;
        Assert.DoesNotContain("<script>", html);
    }
}
