using System.Security.Cryptography.X509Certificates;
using System.Xml.Linq;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.DataProtection.KeyManagement;
using Microsoft.AspNetCore.DataProtection.Repositories;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Ccs.Infrastructure.Security;

/// <summary>
/// Data Protection key ring stored in SQL Server (table ccs.data_protection_keys), so the database carries
/// everything the app needs: moving to a new server = restore the database + import the key certificate.
/// The keys are encrypted with the "CCS Data Protection" certificate, which is NOT in the database:
/// a database backup alone cannot open the saved SMTP password or captcha secret.
/// </summary>
public sealed class SqlKeyRepository(string connectionString) : IXmlRepository
{
    public IReadOnlyCollection<XElement> GetAllElements()
    {
        var list = new List<XElement>();
        using var cn = new SqlConnection(connectionString);
        cn.Open();
        using var cmd = new SqlCommand("SELECT xml FROM ccs.data_protection_keys ORDER BY id", cn);
        using var r = cmd.ExecuteReader();
        while (r.Read()) list.Add(XElement.Parse(r.GetString(0)));
        return list;
    }

    public void StoreElement(XElement element, string friendlyName)
    {
        using var cn = new SqlConnection(connectionString);
        cn.Open();
        using var cmd = new SqlCommand("INSERT INTO ccs.data_protection_keys (friendly_name, xml) VALUES (@n, @x)", cn);
        cmd.Parameters.Add("@n", System.Data.SqlDbType.NVarChar, 200).Value = (object?)friendlyName ?? DBNull.Value;
        cmd.Parameters.Add("@x", System.Data.SqlDbType.NVarChar, -1).Value = element.ToString(SaveOptions.DisableFormatting);
        cmd.ExecuteNonQuery();
    }
}

public static class KeyRing
{
    public const string ApplicationName = "ccs-v2";
    public const string CertificateSubject = "CN=CCS Data Protection";

    /// <summary>Every "CCS Data Protection" certificate with a private key on this machine, newest first.</summary>
    public static List<X509Certificate2> FindCertificates(string? preferredThumbprint)
    {
        var found = new List<X509Certificate2>();
        foreach (var location in new[] { StoreLocation.LocalMachine, StoreLocation.CurrentUser })
        {
            try
            {
                using var store = new X509Store(StoreName.My, location);
                store.Open(OpenFlags.ReadOnly | OpenFlags.OpenExistingOnly);
                foreach (var c in store.Certificates)
                    if (c.HasPrivateKey && (string.Equals(c.Subject, CertificateSubject, StringComparison.OrdinalIgnoreCase)
                        || string.Equals(c.Thumbprint, preferredThumbprint, StringComparison.OrdinalIgnoreCase)))
                        found.Add(c);
            }
            catch (System.Security.Cryptography.CryptographicException) { }   // store missing (e.g. Linux CI)
        }
        return found
            .OrderByDescending(c => string.Equals(c.Thumbprint, preferredThumbprint, StringComparison.OrdinalIgnoreCase))
            .ThenByDescending(c => c.NotAfter)
            .GroupBy(c => c.Thumbprint).Select(g => g.First()).ToList();
    }

    /// <summary>
    /// Keys in SQL Server, encrypted with the CCS certificate. Without a connection string (unit tests) the
    /// default in-memory/local ring is used; without a certificate (developer machine, Linux CI) the keys are
    /// protected with Windows DPAPI when available, else stored unencrypted - the installer always creates the certificate.
    /// </summary>
    public static IDataProtectionBuilder AddCcsKeyRing(this IServiceCollection services, IConfiguration config)
    {
        var dp = services.AddDataProtection().SetApplicationName(ApplicationName);
        var cs = config.GetConnectionString("Ccs");
        if (string.IsNullOrWhiteSpace(cs)) return dp;

        services.Configure<KeyManagementOptions>(o => o.XmlRepository = new SqlKeyRepository(cs));
        var certs = FindCertificates(config["DataProtection:CertificateThumbprint"]);
        if (certs.Count > 0)
        {
            dp.ProtectKeysWithCertificate(certs[0]);
            dp.UnprotectKeysWithAnyCertificate([.. certs]);   // older or imported certificates still open their keys
        }
        else if (OperatingSystem.IsWindows()) dp.ProtectKeysWithDpapi(protectToLocalMachine: true);
        return dp;
    }

    /// <summary>The old key folder (releases before the key ring moved to SQL Server), used once to move secrets.</summary>
    public static string? LegacyFolder(IConfiguration config)
    {
        var f = config["DataProtection:LegacyKeysFolder"];
        if (string.IsNullOrWhiteSpace(f)) f = config["DataProtection:KeysFolder"];
        return !string.IsNullOrWhiteSpace(f) && Directory.Exists(f) && Directory.EnumerateFiles(f, "key-*.xml").Any() ? f : null;
    }
}
