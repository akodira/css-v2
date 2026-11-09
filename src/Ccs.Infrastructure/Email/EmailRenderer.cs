using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Ccs.Domain.Rules;

namespace Ccs.Infrastructure.Email;

public sealed record EmailDesign(
    string HeaderColor = "#0d1b3e", string AccentColor = "#1f64e6", string PageBackground = "#f1f5fb",
    string? LogoUrl = null, bool ShowSiteName = true, bool Rounded = true, bool LargeCodeBox = true)
{
    public static EmailDesign FromJson(string? json)
    {
        if (string.IsNullOrWhiteSpace(json) || json == "{}") return new();
        try { return JsonSerializer.Deserialize<EmailDesign>(json, new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? new(); }
        catch (JsonException) { return new(); }
    }
}

public sealed record RenderedEmail(string Subject, string Html, string Text);

/// <summary>
/// One HTML frame built with tables and inline styles (spec 6, email design), and the small safe Markdown:
/// **bold**, *italic*, [links](https://..), "- " bullets. Text is always HTML-encoded first, never inserted raw.
/// </summary>
public static partial class EmailRenderer
{
    public static string Fill(string template, IReadOnlyDictionary<string, string> values) =>
        Placeholder().Replace(template, m => values.TryGetValue(m.Groups[1].Value, out var v) ? v : m.Value);

    public static RenderedEmail Render(string subject, string body, string? buttonText, string? buttonUrl,
        IReadOnlyDictionary<string, string> values, EmailDesign design, string siteName, string locale, string? footer, string? code = null)
    {
        var s = Fill(subject, values);
        var md = Fill(body, values);
        var dir = locale == "ar" ? "rtl" : "ltr";
        var align = locale == "ar" ? "right" : "left";
        var radius = design.Rounded ? "8px" : "0";
        var html = new StringBuilder();
        html.Append($"""
            <!DOCTYPE html><html lang="{locale}" dir="{dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>{Enc(s)}</title></head>
            <body style="margin:0;padding:0;background:{Css(design.PageBackground)};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{Css(design.PageBackground)};"><tr><td align="center" style="padding:24px 12px;">
            <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:{radius};overflow:hidden;font-family:'IBM Plex Sans','IBM Plex Sans Arabic',Segoe UI,Tahoma,Arial,sans-serif;color:#0f1b2d;">
            <tr><td style="background:{Css(design.HeaderColor)};padding:20px 28px;text-align:{align};">
            """);
        if (design.LogoUrl is not null && SafeLink.IsAllowed(design.LogoUrl))
            html.Append($"<img src=\"{Enc(design.LogoUrl)}\" alt=\"{Enc(siteName)}\" height=\"32\" style=\"height:32px;border:0;vertical-align:middle;\">");
        if (design.ShowSiteName)
            html.Append($"<span style=\"color:#ffffff;font-size:18px;font-weight:600;vertical-align:middle;padding:0 8px;\">{Enc(siteName)}</span>");
        html.Append($"</td></tr><tr><td style=\"padding:28px;text-align:{align};font-size:15px;line-height:1.6;\" dir=\"{dir}\">");
        html.Append(MarkdownToHtml(md, design.AccentColor));
        if (code is not null)
        {
            var size = design.LargeCodeBox ? "32px" : "22px";
            html.Append($"<div style=\"margin:20px 0;padding:16px;background:#e5eefd;border-radius:{radius};text-align:center;font-size:{size};font-weight:700;letter-spacing:6px;\">{Enc(code)}</div>");
        }
        if (!string.IsNullOrWhiteSpace(buttonText) && buttonUrl is not null && SafeLink.IsAllowed(buttonUrl))
            html.Append($"<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:24px 0;\"><tr><td style=\"background:{Css(design.AccentColor)};border-radius:{radius};\"><a href=\"{Enc(buttonUrl)}\" style=\"display:inline-block;padding:12px 24px;color:#ffffff;font-weight:600;text-decoration:none;\">{Enc(Fill(buttonText, values))}</a></td></tr></table>");
        html.Append("</td></tr>");
        if (!string.IsNullOrWhiteSpace(footer))
            html.Append($"<tr><td style=\"padding:16px 28px;border-top:1px solid #e2e8f3;color:#52607a;font-size:12px;text-align:{align};\">{Enc(footer)}</td></tr>");
        html.Append("</table></td></tr></table></body></html>");

        var text = new StringBuilder(StripMarkdown(md));
        if (code is not null) text.Append("\n\n").Append(code);
        if (buttonUrl is not null) text.Append("\n\n").Append(buttonUrl);
        if (!string.IsNullOrWhiteSpace(footer)) text.Append("\n\n--\n").Append(footer);
        return new RenderedEmail(s, html.ToString(), text.ToString());
    }

    public static string MarkdownToHtml(string md, string accent)
    {
        var sb = new StringBuilder();
        var inList = false;
        foreach (var raw in md.Replace("\r\n", "\n").Split('\n'))
        {
            var line = raw.TrimEnd();
            if (line.StartsWith("- ") || line.StartsWith("* "))
            {
                if (!inList) { sb.Append("<ul style=\"padding-inline-start:20px;margin:8px 0;\">"); inList = true; }
                sb.Append("<li>").Append(Inline(line[2..], accent)).Append("</li>");
                continue;
            }
            if (inList) { sb.Append("</ul>"); inList = false; }
            if (line.Length == 0) continue;
            sb.Append("<p style=\"margin:0 0 12px;\">").Append(Inline(line, accent)).Append("</p>");
        }
        if (inList) sb.Append("</ul>");
        return sb.ToString();
    }

    private static string Inline(string text, string accent)
    {
        var s = Enc(text);
        s = Link().Replace(s, m =>
        {
            var href = WebUtility.HtmlDecode(m.Groups[2].Value);
            return SafeLink.IsAllowed(href) ? $"<a href=\"{Enc(href)}\" style=\"color:{Css(accent)};\">{m.Groups[1].Value}</a>" : m.Groups[1].Value;
        });
        s = Bold().Replace(s, "<strong>$1</strong>");
        s = Italic().Replace(s, "<em>$1</em>");
        return s;
    }

    private static string StripMarkdown(string md) => Italic().Replace(Bold().Replace(Link().Replace(md, "$1 ($2)"), "$1"), "$1");

    private static string Enc(string s) => WebUtility.HtmlEncode(s);
    private static string Css(string color) => CssColor().IsMatch(color) ? color : "#1f64e6";

    [GeneratedRegex(@"\{([a-zA-Z_]+)\}")] private static partial Regex Placeholder();
    [GeneratedRegex(@"\[([^\]]+)\]\(([^)\s]+)\)")] private static partial Regex Link();
    [GeneratedRegex(@"\*\*(.+?)\*\*")] private static partial Regex Bold();
    [GeneratedRegex(@"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)")] private static partial Regex Italic();
    [GeneratedRegex(@"^#[0-9a-fA-F]{6}$")] private static partial Regex CssColor();
}
