import { assertEquals, assertRejects } from 'jsr:@std/assert@1'
import { ensureNotificationPreferenceDefaults } from './notification_registration.ts'

Deno.test('registration inserts preference defaults without overwriting existing rows', async () => {
  const calls: Array<{ table: string; values: Record<string, unknown>; options: Record<string, unknown> }> = []
  const state: { stored: Record<string, unknown> | null } = { stored: null }
  const client = {
    from(table: string) {
      return {
        async upsert(values: Record<string, unknown>, options: Record<string, unknown>) {
          calls.push({ table, values, options })
          if (!state.stored || options.ignoreDuplicates !== true) state.stored = { ...values }
          return { error: null }
        },
      }
    },
  }

  await ensureNotificationPreferenceDefaults(client, {
    installId: 'install-1',
    userId: 'user-1',
    timezone: 'Asia/Bangkok',
    hideAmounts: true,
  })
  if (!state.stored) throw new Error('preference row was not created')
  state.stored.daily_expense_enabled = false
  state.stored.timezone = 'Europe/London'
  state.stored.hide_amounts_in_notification = false
  await ensureNotificationPreferenceDefaults(client, {
    installId: 'install-1',
    userId: 'user-1',
    timezone: 'Asia/Bangkok',
    hideAmounts: true,
  })

  assertEquals(state.stored, {
    install_id: 'install-1',
    user_id: 'user-1',
    daily_expense_enabled: false,
    timezone: 'Europe/London',
    hide_amounts_in_notification: false,
  })
  assertEquals(calls[0], {
    table: 'mt_notification_preferences',
    values: {
      install_id: 'install-1',
      user_id: 'user-1',
      daily_expense_enabled: true,
      timezone: 'Asia/Bangkok',
      hide_amounts_in_notification: true,
    },
    options: { onConflict: 'install_id', ignoreDuplicates: true },
  })
  assertEquals(calls.length, 2)
})

Deno.test('registration surfaces preference insert errors', async () => {
  const client = {
    from() {
      return {
        async upsert() {
          return { error: { message: 'preference write failed' } }
        },
      }
    },
  }

  await assertRejects(
    () => ensureNotificationPreferenceDefaults(client, {
      installId: 'install-1',
      userId: 'user-1',
      timezone: 'Asia/Bangkok',
      hideAmounts: false,
    }),
    Error,
    'preference write failed',
  )
})
