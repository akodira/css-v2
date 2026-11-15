using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Ccs.Domain.Rules;

namespace Ccs.Infrastructure.Email;

/// <summary>The look of every email (Settings → Email → Design). New options default to the Nov 2026 design.</summary>
public sealed record EmailDesign(
    string HeaderColor = "#0b1a3a", string AccentColor = "#1f64e6", string PageBackground = "#f0f4fb",
    string? LogoUrl = null, bool ShowSiteName = true, bool Rounded = true, bool LargeCodeBox = true,
    bool Stripes = true, string TaglineEn = "", string TaglineAr = "", bool GreetingIcon = true,
    string FooterNoteEn = "This is an automated message. Please do not reply.", string FooterNoteAr = "هذه رسالة آلية، يُرجى عدم الرد عليها.",
    bool FooterLogo = true, bool FooterSocial = true)
{
    public static EmailDesign FromJson(string? json)
    {
        if (string.IsNullOrWhiteSpace(json) || json == "{}") return new();
        try { return JsonSerializer.Deserialize<EmailDesign>(json, new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? new(); }
        catch (JsonException) { return new(); }
    }
}

/// <summary>What the frame needs besides the design: the greeting line (already filled with FillText), the site address (for icons and pictures), the footer logo and social links.</summary>
public sealed record EmailExtras(string? Greeting = null, string? SiteUrl = null, string? FooterLogoUrl = null, IReadOnlyList<(string Kind, string Url)>? Social = null);

public sealed record RenderedEmail(string Subject, string Html, string Text);

/// <summary>
/// One HTML frame built with tables and inline styles (spec 6, email design), and the small safe Markdown written by
/// administrators in Email templates: **bold**, *italic*, [links](https://..), "- " bullets, "## " headings,
/// [center] / [end] / [justify] paragraphs, [line], [tip]Title | text, [size=small|large|xl]..[/size], [color=#hex]..[/color],
/// [mark]..[/mark], ![alt](uploaded picture), | tables | and ``` code blocks. Text is always HTML-encoded first.
/// </summary>
public static partial class EmailRenderer
{
    /// <summary>Raw fill: for plain text (subject) and URLs (button link).</summary>
    public static string Fill(string template, IReadOnlyDictionary<string, string> values) =>
        Placeholder().Replace(template, m => values.TryGetValue(m.Groups[1].Value, out var v) ? v : m.Value);

    /// <summary>
    /// Fill for text that is later read as Markdown (body, greeting, footer). Values come from people (a name, a ticket
    /// subject, a reason), so their Markdown is neutralised: they cannot become a link, a picture, a mark or bold/italic
    /// text (security audit M-03). Only the template itself, written by administrators, can contain formatting.
    /// </summary>
    public static string FillText(string template, IReadOnlyDictionary<string, string> values) =>
        Placeholder().Replace(template, m => values.TryGetValue(m.Groups[1].Value, out var v) ? Neutral(v) : m.Value);

    /// <summary>
    /// "](" and "[" get a zero-width space so no [link](..), ![picture](..), [mark] or [color] can form; "*" becomes "∗";
    /// code fences break.
    /// </summary>
    public static string Neutral(string value) =>
        value.Replace("](", "]​(").Replace("[", "[​").Replace('*', '∗').Replace("```", "`​``");

    public static RenderedEmail Render(string subject, string body, string? buttonText, string? buttonUrl,
        IReadOnlyDictionary<string, string> values, EmailDesign design, string siteName, string locale, string? footer, string? code = null,
        EmailExtras? extras = null)
    {
        extras ??= new EmailExtras();
        var s = Fill(subject, values);
        var md = FillText(body, values);
        var ar = locale == "ar";
        var dir = ar ? "rtl" : "ltr";
        var align = ar ? "right" : "left";
        var radius = design.Rounded ? "10px" : "0";
        var header = Css(design.HeaderColor);
        var accent = Css(design.AccentColor);
        var site = extras.SiteUrl?.TrimEnd('/');
        var html = new StringBuilder();
        html.Append($"""
            <!DOCTYPE html><html lang="{locale}" dir="{dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>{Enc(s)}</title></head>
            <body style="margin:0;padding:0;background:{Css(design.PageBackground)};">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{Css(design.PageBackground)};"><tr><td align="center" style="padding:24px 12px;">
            <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:{radius};overflow:hidden;font-family:'IBM Plex Sans','IBM Plex Sans Arabic','Segoe UI',Tahoma,Arial,sans-serif;color:#0f1b2d;" dir="{dir}">
            """);

        // ---- header: logo | divider | tagline, on dark blue (with blue stripes when the design asks for them)
        var stripes = design.Stripes
            ? $"background-color:{header};background-image:linear-gradient({(ar ? 245 : 115)}deg,{header} 0%,{header} 58%,#0f2a66 58%,#0f2a66 70%,{accent} 70%,{accent} 76%,#13357f 76%,#13357f 84%,{header} 84%);"
            : $"background:{header};border-bottom:4px solid {accent};";
        html.Append($"<tr><td bgcolor=\"{header}\" style=\"{stripes}padding:22px 28px;text-align:{align};\">");
        html.Append("<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\"><tr>");
        var logo = design.LogoUrl is not null && SafeLink.IsAllowed(design.LogoUrl);
        if (logo) html.Append($"<td style=\"vertical-align:middle;\"><img src=\"{Enc(design.LogoUrl!)}\" alt=\"{Enc(siteName)}\" height=\"34\" style=\"height:34px;border:0;display:block;\"></td>");
        var tagline = (ar ? design.TaglineAr : design.TaglineEn).Trim();
        if (design.ShowSiteName && (!logo || tagline.Length == 0))
            html.Append($"<td style=\"vertical-align:middle;padding:0 10px;color:#ffffff;font-size:18px;font-weight:600;\">{Enc(siteName)}</td>");
        if (tagline.Length > 0)
        {
            if (logo || design.ShowSiteName) html.Append("<td style=\"padding:0 18px;\"><div style=\"width:1px;height:42px;background:#5b6f99;\"></div></td>");
            var lines = string.Join("<br>", Regex.Split(tagline, @"(?<=[.!؟?])\s+").Select(Enc));
            html.Append($"<td style=\"vertical-align:middle;color:#ffffff;font-size:15px;line-height:1.35;font-weight:500;\">{lines}</td>");
        }
        html.Append("</tr></table></td></tr>");

        // ---- body: greeting (with the person icon), text, code box, button
        html.Append($"<tr><td style=\"padding:26px 28px 8px;text-align:{align};font-size:15px;line-height:1.6;\" dir=\"{dir}\">");
        if (!string.IsNullOrWhiteSpace(extras.Greeting))
        {
            var g = Inline(extras.Greeting!, accent);   // already filled (FillText) by the caller
            if (design.GreetingIcon && site is not null)
                html.Append($"<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:0 0 16px;\"><tr><td style=\"vertical-align:middle;\"><img src=\"{EmailAssets.Url(site, "person")}\" width=\"46\" height=\"46\" alt=\"\" style=\"display:block;border:0;\"></td><td style=\"vertical-align:middle;padding:0 14px;font-size:20px;font-weight:700;\">{g}</td></tr></table>");
            else html.Append($"<p style=\"margin:0 0 14px;font-size:18px;font-weight:700;\">{g}</p>");
        }
        html.Append(MarkdownToHtml(md, accent, dir, site));
        if (code is not null)
        {
            var size = design.LargeCodeBox ? "32px" : "22px";
            html.Append($"<div style=\"margin:20px 0;padding:16px;background:#e5eefd;border-radius:{radius};text-align:center;font-size:{size};font-weight:700;letter-spacing:6px;\" dir=\"ltr\">{Enc(code)}</div>");
        }
        if (!string.IsNullOrWhiteSpace(buttonText) && buttonUrl is not null && SafeLink.IsAllowed(buttonUrl))
            html.Append($"<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:24px 0;\"><tr><td style=\"background:{accent};border-radius:{radius};\"><a href=\"{Enc(buttonUrl)}\" style=\"display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-weight:600;\">{Enc(Fill(buttonText, values))}</a></td></tr></table>");
        html.Append("</td></tr>");

        // ---- footer: the template's footer text, then logo | divider | note ... social icons
        if (!string.IsNullOrWhiteSpace(footer))
            html.Append($"<tr><td style=\"padding:4px 28px 0;color:#52607a;font-size:12px;text-align:{align};\" dir=\"{dir}\">{MarkdownToHtml(footer, accent, dir, site)}</td></tr>");
        var note = (ar ? design.FooterNoteAr : design.FooterNoteEn).Trim();
        var footLogo = design.FooterLogo && extras.FooterLogoUrl is { } fl && SafeLink.IsAllowed(fl) ? fl : null;
        var social = design.FooterSocial && site is not null ? (extras.Social ?? []).Where(x => EmailAssets.Names.Contains(x.Kind) && x.Url.StartsWith("https://") && SafeLink.IsAllowed(x.Url)).ToList() : [];
        if (footLogo is not null || note.Length > 0 || social.Count > 0)
        {
            html.Append($"<tr><td style=\"padding:14px 28px 18px;\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"border-top:1px solid #e2e8f3;\"><tr>");
            if (footLogo is not null) html.Append($"<td style=\"padding-top:14px;vertical-align:middle;width:1%;\"><img src=\"{Enc(footLogo)}\" alt=\"{Enc(siteName)}\" height=\"24\" style=\"height:24px;border:0;display:block;\"></td>");
            if (footLogo is not null && note.Length > 0) html.Append("<td style=\"padding:14px 14px 0;width:1%;\"><div style=\"width:1px;height:28px;background:#d3dbea;\"></div></td>");
            html.Append($"<td style=\"padding-top:14px;vertical-align:middle;color:#52607a;font-size:12px;text-align:{align};\">{Enc(note)}</td>");
            if (social.Count > 0)
            {
                html.Append($"<td style=\"padding-top:14px;vertical-align:middle;text-align:{(ar ? "left" : "right")};white-space:nowrap;\">");
                foreach (var (kind, url) in social)
                    html.Append($"<a href=\"{Enc(url)}\" style=\"display:inline-block;margin:0 3px;\"><img src=\"{EmailAssets.Url(site!, kind)}\" width=\"30\" height=\"30\" alt=\"{kind}\" style=\"display:block;border:0;\"></a>");
                html.Append("</td>");
            }
            html.Append("</tr></table></td></tr>");
        }
        html.Append($"<tr><td style=\"height:6px;line-height:6px;font-size:0;background:{accent};\">&nbsp;</td></tr>");
        html.Append("</table></td></tr></table></body></html>");

        var text = new StringBuilder();
        if (!string.IsNullOrWhiteSpace(extras.Greeting)) text.Append(StripMarkdown(extras.Greeting!)).Append("\n\n");
        text.Append(StripMarkdown(md));
        if (code is not null) text.Append("\n\n").Append(code);
        if (buttonUrl is not null) text.Append("\n\n").Append(buttonUrl);
        if (!string.IsNullOrWhiteSpace(footer)) text.Append("\n\n--\n").Append(StripMarkdown(footer));
        if (note.Length > 0) text.Append("\n").Append(note);
        return new RenderedEmail(s, html.ToString(), text.ToString());
    }

    /// <summary>Administrator Markdown to email-safe HTML. <paramref name="siteUrl"/> is needed for pictures and the tip-box icon.</summary>
    public static string MarkdownToHtml(string md, string accent, string dir = "ltr", string? siteUrl = null)
    {
        var start = dir == "rtl" ? "right" : "left";
        var end = dir == "rtl" ? "left" : "right";
        var sb = new StringBuilder();
        var lines = md.Replace("\r\n", "\n").Split('\n');
        for (var i = 0; i < lines.Length; i++)
        {
            var line = lines[i].TrimEnd();

            // code block: everything between ``` fences, shown as it is
            if (line.TrimStart().StartsWith("```"))
            {
                var code = new List<string>();
                for (i++; i < lines.Length && !lines[i].TrimStart().StartsWith("```"); i++) code.Add(lines[i]);
                sb.Append("<pre style=\"margin:0 0 12px;padding:12px 14px;background:#0f1b2d;color:#e5eefd;border-radius:8px;font-family:Consolas,'Courier New',monospace;font-size:13px;line-height:1.5;white-space:pre-wrap;text-align:left;\" dir=\"ltr\">")
                  .Append(Enc(string.Join("\n", code))).Append("</pre>");
                continue;
            }
            // list
            if (line.StartsWith("- ") || line.StartsWith("* "))
            {
                sb.Append("<ul style=\"padding-inline-start:20px;margin:8px 0 12px;\">");
                for (; i < lines.Length && (lines[i].StartsWith("- ") || lines[i].StartsWith("* ")); i++) sb.Append("<li>").Append(Inline(lines[i][2..].TrimEnd(), accent)).Append("</li>");
                i--; sb.Append("</ul>");
                continue;
            }
            // table: rows of | cells |, the first row is the heading, a | --- | row is skipped
            if (line.StartsWith('|'))
            {
                sb.Append("<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"border-collapse:collapse;margin:0 0 12px;font-size:14px;\">");
                var first = true;
                for (; i < lines.Length && lines[i].TrimEnd().StartsWith('|'); i++)
                {
                    var row = lines[i].Trim().Trim('|');
                    if (TableRule().IsMatch(row)) continue;
                    var tag = first ? "th" : "td";
                    sb.Append("<tr>");
                    foreach (var cell in row.Split('|'))
                        sb.Append($"<{tag} style=\"border:1px solid #e2e8f3;padding:7px 9px;text-align:{start};{(first ? "background:#f0f4fb;font-weight:600;" : "")}\">{Inline(cell.Trim(), accent)}</{tag}>");
                    sb.Append("</tr>");
                    first = false;
                }
                i--; sb.Append("</table>");
                continue;
            }
            if (line.Length == 0) continue;

            var a = start;
            var am = AlignMark().Match(line);
            if (am.Success) { a = am.Groups[1].Value switch { "center" => "center", "justify" => "justify", "end" => end, _ => start }; line = line[am.Length..]; }

            if (line == "[line]") { sb.Append("<hr style=\"border:0;border-top:1px solid #e2e8f3;margin:16px 0;\">"); continue; }
            if (line.StartsWith("[tip]"))
            {
                var parts = line[5..].Split('|', 2);
                var icon = siteUrl is null ? "" : $"<td style=\"vertical-align:middle;padding:0 12px 0 0;width:40px;\"><img src=\"{EmailAssets.Url(siteUrl, "shield")}\" width=\"36\" height=\"36\" alt=\"\" style=\"display:block;border:0;\"></td><td style=\"width:1px;background:#b9cdf5;\"></td>";
                sb.Append($"<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin:4px 0 14px;background:#e5eefd;border-radius:10px;\"><tr><td style=\"padding:12px 14px;\"><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\"><tr>{icon}<td style=\"vertical-align:middle;padding:0 12px;text-align:{start};\">")
                  .Append($"<div style=\"font-weight:700;color:#0f2a66;\">{Inline(parts[0].Trim(), accent)}</div>");
                if (parts.Length > 1) sb.Append($"<div style=\"font-size:14px;color:#1d3566;\">{Inline(parts[1].Trim(), accent)}</div>");
                sb.Append("</td></tr></table></td></tr></table>");
                continue;
            }
            var img = Picture().Match(line);
            if (img.Success)
            {
                var src = PictureUrl(img.Groups[2].Value, siteUrl);
                if (src is not null)
                    sb.Append($"<p style=\"margin:0 0 12px;text-align:{(am.Success ? a : "center")};\"><img src=\"{Enc(src)}\" alt=\"{Enc(img.Groups[1].Value)}\" style=\"max-width:100%;height:auto;border:0;border-radius:8px;\"></p>");
                continue;
            }
            if (line.StartsWith("## "))
            {
                sb.Append($"<p style=\"margin:4px 0 10px;font-size:20px;line-height:1.35;font-weight:700;text-align:{a};\">{Inline(line[3..], accent)}</p>");
                continue;
            }
            sb.Append($"<p style=\"margin:0 0 12px;text-align:{a};\">").Append(Inline(line, accent)).Append("</p>");
        }
        return sb.ToString();
    }

    /// <summary>Only pictures uploaded from the editor (served by this site) are shown; any other address is dropped.</summary>
    private static string? PictureUrl(string url, string? siteUrl)
    {
        var path = siteUrl is not null && url.StartsWith(siteUrl + "/", StringComparison.OrdinalIgnoreCase) ? url[siteUrl.Length..] : url;
        if (!EmailImagePath().IsMatch(path)) return null;
        return siteUrl is null ? path : siteUrl + path;
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
        s = SizeMark().Replace(s, m => $"<span style=\"font-size:{m.Groups[1].Value switch { "small" => "13px", "large" => "19px", _ => "24px" }};\">{m.Groups[2].Value}</span>");
        s = ColorMark().Replace(s, "<span style=\"color:$1;\">$2</span>");
        s = HighlightMark().Replace(s, "<span style=\"background:#fff1a8;padding:0 2px;\">$1</span>");
        return s;
    }

    private static string StripMarkdown(string md)
    {
        var s = Picture().Replace(md, "");
        s = AlignMark().Replace(s, "");
        s = s.Replace("[line]", "----").Replace("```", "");
        s = Regex.Replace(s, @"^\[tip\]([^|\n]*)\|?", "$1: ", RegexOptions.Multiline);
        s = Regex.Replace(s, @"^## ", "", RegexOptions.Multiline);
        s = SizeMark().Replace(s, "$2"); s = ColorMark().Replace(s, "$2"); s = HighlightMark().Replace(s, "$1");
        return Italic().Replace(Bold().Replace(Link().Replace(s, "$1 ($2)"), "$1"), "$1");
    }

    private static string Enc(string s) => WebUtility.HtmlEncode(s);
    private static string Css(string color) => CssColor().IsMatch(color) ? color : "#1f64e6";

    [GeneratedRegex(@"\{([a-zA-Z_]+)\}")] private static partial Regex Placeholder();
    [GeneratedRegex(@"(?<!!)\[([^\]]+)\]\(([^)\s]+)\)")] private static partial Regex Link();
    [GeneratedRegex(@"\*\*(.+?)\*\*")] private static partial Regex Bold();
    [GeneratedRegex(@"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)")] private static partial Regex Italic();
    [GeneratedRegex(@"^#[0-9a-fA-F]{6}$")] private static partial Regex CssColor();
    [GeneratedRegex(@"^\[(center|end|start|justify)]")] private static partial Regex AlignMark();
    [GeneratedRegex(@"^!\[([^\]]*)\]\(([^)\s]+)\)$")] private static partial Regex Picture();
    [GeneratedRegex(@"^/api/site/email-images/[0-9a-f]{32}\.(png|jpg|jpeg|gif|webp)$")] private static partial Regex EmailImagePath();
    [GeneratedRegex(@"\[size=(small|large|xl)\](.+?)\[/size\]")] private static partial Regex SizeMark();
    [GeneratedRegex(@"\[color=(#[0-9a-fA-F]{6})\](.+?)\[/color\]")] private static partial Regex ColorMark();
    [GeneratedRegex(@"\[mark\](.+?)\[/mark\]")] private static partial Regex HighlightMark();
    [GeneratedRegex(@"^\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*$")] private static partial Regex TableRule();
}
