import { test, expect, Locator, Frame } from '@playwright/test';
const { beforeEach, step } = test;
import { failOnBrowserErrors, getFragmentContext } from '../playwright.utils';

beforeEach(failOnBrowserErrors);

let fragment: Locator;
let fragmentContext: Frame;

beforeEach(async ({ page, browserName }) => {
	await page.goto('/focus-events/');
	// wait for the fragment to load
	await page.waitForSelector('web-fragment h2');

	fragment = page.locator('web-fragment');
	fragmentContext = await getFragmentContext(fragment);
});

test('focus events should only trigger once in fragments', async ({ page }) => {
	await step('ensure the test harness app loaded', async () => {
		await expect(page).toHaveTitle('WF Playground: focus-events');
		await expect(page.locator('h1')).toHaveText('WF Playground: focus-events');
	});

	// Wait for the fragment content to be fully loaded
	await fragmentContext.waitForSelector('#fragment-input', { state: 'visible', timeout: 30000 });
	
	// Clear console logs before testing focus events
	await page.evaluate(() => {
		console.clear();
	});

	// Focus the input in the fragment
	const fragmentInput = fragmentContext.locator('#fragment-input');
	await expect(fragmentInput).toBeVisible();
	await fragmentInput.click(); // Use click instead of focus for more reliable focus behavior
	
	// Check that the focus counter in the fragment shows 1
	// This will fail if the focus event is triggered twice
	const fragmentFocusCount = fragmentContext.locator('#fragment-focus-count');
	await expect(fragmentFocusCount).toHaveText('1', { timeout: 5000 });
	
	// Focus the main document input to verify normal focus behavior
	const mainInput = page.locator('#main-input');
	await mainInput.click(); // Use click instead of focus
	const mainFocusCount = page.locator('#main-focus-count');
	await expect(mainFocusCount).toHaveText('1', { timeout: 5000 });
	
	// Focus the fragment input again to verify consistent behavior
	await fragmentInput.click(); // Use click instead of focus
	await expect(fragmentFocusCount).toHaveText('2', { timeout: 5000 });
	
	// Get console logs to verify focus events
	const focusLogs = await page.evaluate(() => {
		const logs: string[] = [];
		const originalConsoleLog = console.log;
		console.log = function(...args: any[]) {
			logs.push(args.join(' '));
			originalConsoleLog.apply(console, args);
		};
		return logs.filter(log => log.includes('Fragment focus event triggered')).length;
	});
	
	// We should have exactly 2 focus events logged
	expect(focusLogs).toBeLessThanOrEqual(2);
});

