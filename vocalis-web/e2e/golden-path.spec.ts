import { expect, test } from '@playwright/test'

// One person, start to finish: sign up, make an agent, create an API key, ask for help, invite a teammate.
test('golden path', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`
  await page.goto('/')
  await page.getByRole('button', { name: /new here/i }).click()
  await page.getByPlaceholder('Your name').fill('Eve Tester')
  await page.getByPlaceholder('Email').fill(email)
  await page.getByPlaceholder(/Password/).fill('password123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText(/Talk to your agent now/)).toBeVisible()

  // An agent made through the API shows up in the app (the session cookie is shared).
  const made = await page.request.post('/api/v1/product/agents', { data: { name: 'Front desk', template: 'receptionist' }, headers: { 'X-Environment': 'test' } })
  expect(made.ok()).toBeTruthy()
  await page.goto('/agents')
  await expect(page.getByText('Front desk').first()).toBeVisible()

  await page.goto('/developers')
  await page.getByLabel('Key name').fill('e2e')
  await page.getByRole('button', { name: /create key/i }).click()
  await expect(page.getByText(/sk_test_/).first()).toBeVisible()

  await page.goto('/help')
  await page.getByLabel('Your question').fill('how do webhooks work')
  await page.getByRole('button', { name: 'Ask' }).click()
  await expect(page.getByText(/signed|web address|Developers/i).first()).toBeVisible()

  await page.goto('/settings')
  await page.getByRole('button', { name: /invite/i }).click()
  await page.getByPlaceholder('name@company.com').fill('mate@example.com')
  await page.getByRole('button', { name: /create invite link/i }).click()
  await expect(page.getByText(/\/invite\//)).toBeVisible()
})
