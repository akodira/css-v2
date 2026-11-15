namespace Ccs.Infrastructure.Email;

/// <summary>Icons drawn inside emails, built into the program (Email/assets/*.png) and served by GET /api/site/email-assets/{name}.png.</summary>
public static class EmailAssets
{
    public static readonly string[] Names = ["person", "shield", "web", "linkedin", "youtube", "facebook", "x"];

    public static Stream? Open(string name) =>
        Names.Contains(name) ? typeof(EmailAssets).Assembly.GetManifestResourceStream($"Ccs.EmailAssets.{name}.png") : null;

    /// <summary>Absolute address of an icon, for use in an email.</summary>
    public static string Url(string siteUrl, string name) => $"{siteUrl.TrimEnd('/')}/api/site/email-assets/{name}.png";
}
