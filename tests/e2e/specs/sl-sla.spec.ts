import { expect, go, manual, test } from '../support/fixtures';
import { ok } from '../support/data';
import { t } from '../support/i18n';

/** Sheet "SL SLA". SLA targets and calendars apply to every ticket, so they are only read here; edits stay manual. */
test.describe('SL SLA', () => {
  test('TC-SL-001 SLA targets', async ({ asRole, apiAs }) => {
    const sla = await ok<unknown>((await apiAs('admin')).get('/api/admin/sla'));
    expect(JSON.stringify(sla)).toMatch(/resolutionMinutes|firstResponseMinutes/i);
    const page = await asRole('admin');
    await go(page, '/en/admin/sla');
    await expect(page.getByRole('heading', { level: 1, name: t('AdminSla.title') })).toBeVisible();
    await expect(page.locator('main'), 'targets by priority shown').toContainText(/First reply \d+ min/);
    test.info().annotations.push({ type: 'manual part', description: 'saving new targets and the recalculation option change every open ticket: check by hand' });
  });

  manual('TC-SL-002', 'Business calendars', 'applying or deleting a calendar changes the clocks of all open tickets');
  manual('TC-SL-003', 'Holidays and working hours', 'needs a holiday and watching the clocks over time');
  manual('TC-SL-004', 'SLA warnings', 'needs a ticket to approach its target (waiting time) and the background jobs on');

  test('TC-SL-005 SLA report', async ({ asRole, apiAs }) => {
    const rep = await ok<Record<string, unknown>>((await apiAs('teamLeader')).get('/api/reports/sla'));
    const page = await asRole('teamLeader');
    await go(page, '/en/console/sla');
    await expect(page.getByRole('heading', { level: 1, name: t('SlaReport.title') })).toBeVisible();
    const nums = JSON.stringify(rep).match(/"(met|atRisk|dueSoon|breached|onTrack)"\s*:\s*(\d+)/g) ?? [];
    expect(nums.length, 'met / at risk / breached counts from the API').toBeGreaterThan(0);
    await expect(page.locator('main')).toContainText(/\d/);
  });
});
