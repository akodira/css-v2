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

    // ---------------------------------------------------------------- editor formatting (Nov 2026)

    private static string Md(string md) => EmailRenderer.MarkdownToHtml(md, "#1f64e6", "ltr", "https://ccs.example");

    [Fact]
    public void Alignment_heading_line_and_tip_box_render()
    {
        var html = Md("[center]Hello\n[end]Bye\n## Your code\n[line]\n[tip]Security tip | Keep it secret");
        Assert.Contains("text-align:center;\">Hello", html);
        Assert.Contains("text-align:right;\">Bye", html);
        Assert.Contains("font-size:20px", html);
        Assert.Contains("<hr", html);
        Assert.Contains("Security tip", html);
        Assert.Contains("https://ccs.example/api/site/email-assets/shield.png", html);
    }

    [Fact]
    public void End_alignment_is_left_in_arabic()
        => Assert.Contains("text-align:left;\">مع السلامة", EmailRenderer.MarkdownToHtml("[end]مع السلامة", "#1f64e6", "rtl"));

    [Fact]
    public void Size_colour_and_highlight_render()
    {
        var html = Md("[size=large]Big[/size] [color=#b42318]Red[/color] [mark]Note[/mark]");
        Assert.Contains("font-size:19px;\">Big", html);
        Assert.Contains("color:#b42318;\">Red", html);
        Assert.Contains("background:#fff1a8", html);
    }

    [Fact]
    public void Table_and_code_block_render()
    {
        var html = Md("| Item | Value |\n| --- | --- |\n| Ticket | REQ-26-0001 |\n```\nError <5>\n```");
        Assert.Contains("<th", html);
        Assert.Contains(">REQ-26-0001</td>", html);
        Assert.DoesNotContain("---", html);
        Assert.Contains("<pre", html);
        Assert.Contains("Error &lt;5&gt;", html);
    }

    [Fact]
    public void Only_pictures_uploaded_to_this_site_are_shown()
    {
        var ok = Md("![Map](/api/site/email-images/0123456789abcdef0123456789abcdef.png)");
        Assert.Contains("src=\"https://ccs.example/api/site/email-images/0123456789abcdef0123456789abcdef.png\"", ok);
        Assert.DoesNotContain("<img", Md("![Pixel](https://tracker.example/p.gif)"));
    }

    [Fact]
    public void Values_cannot_create_marks_pictures_or_code()
    {
        var html = Render("Hi {name}", new()
        {
            ["name"] = "[color=#ff0000]x[/color] [mark]y[/mark] ![p](/api/site/email-images/0123456789abcdef0123456789abcdef.png) ```",
        }).Html;
        Assert.DoesNotContain("color:#ff0000", html);
        Assert.DoesNotContain("#fff1a8", html);
        Assert.DoesNotContain("<img src=\"/api/site/email-images", html);
        Assert.DoesNotContain("<pre", html);
    }
}
