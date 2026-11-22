using Ccs.Domain;
using Ccs.Domain.Rules;

namespace Ccs.Tests.Domain;

/// <summary>Settings → Security extras: device names, shortened addresses, longest sign-in and the required two-step deadline.</summary>
public class SecurityExtrasTests
{
    static readonly DateTimeOffset T0 = new(2026, 11, 22, 10, 0, 0, TimeSpan.Zero);

    [Theory]
    [InlineData("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", "Chrome on Windows")]
    [InlineData("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0", "Edge on Windows")]
    [InlineData("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", "Safari on iPhone")]
    [InlineData("Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:132.0) Gecko/20100101 Firefox/132.0", "Firefox on Mac")]
    [InlineData("Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36", "Samsung Internet on Android")]
    [InlineData(null, "Unknown device")]
    public void Device_labels_ignore_versions(string? ua, string expected) => Assert.Equal(expected, DeviceInfo.Label(ua));

    [Theory]
    [InlineData("41.233.12.7", "41.233.x.x")]
    [InlineData("::ffff:197.55.1.2", "197.55.x.x")]
    [InlineData("2a02:9b0:4040:1::5", "2a02:9b0:…")]
    [InlineData(null, "")]
    public void Addresses_are_shortened(string? ip, string expected) => Assert.Equal(expected, DeviceInfo.MaskIp(ip));

    [Fact]
    public void Groups_follow_the_roles()
    {
        Assert.Equal(SecurityGroups.Admins, SecurityGroups.Of([RoleCode.Admin, RoleCode.Agent]));
        Assert.Equal(SecurityGroups.Staff, SecurityGroups.Of([RoleCode.Agent]));
        Assert.Equal(SecurityGroups.Customers, SecurityGroups.Of([RoleCode.Customer]));
    }

    [Fact]
    public void Longest_sign_in_differs_for_staff_and_customers()
    {
        var p = new SecurityExtras();
        Assert.Equal(TimeSpan.FromHours(12), p.MaxSession(SecurityGroups.Staff));
        Assert.Equal(TimeSpan.FromHours(12), p.MaxSession(SecurityGroups.Admins));
        Assert.Equal(TimeSpan.FromDays(14), p.MaxSession(SecurityGroups.Customers));
    }

    [Fact]
    public void Two_step_deadline_counts_from_the_switch_on_or_the_account()
    {
        var p = new SecurityExtras(MfaStaff: true, MfaSetupDays: 7, MfaStaffSince: T0);
        Assert.Null(p.MfaDeadline(SecurityGroups.Customers, T0));                              // not required
        Assert.Equal(T0.AddDays(7), p.MfaDeadline(SecurityGroups.Staff, T0.AddYears(-1)));     // old account: from the switch-on
        Assert.Equal(T0.AddDays(10 + 7), p.MfaDeadline(SecurityGroups.Staff, T0.AddDays(10))); // newer account: from its creation
        Assert.Equal(T0, (p with { MfaSetupDays = 0 }).MfaDeadline(SecurityGroups.Staff, T0.AddYears(-1)));
    }
}
