type InsertError = { message: string; code?: string } | null

type PreferenceInsertClient = {
  from: (table: string) => {
    upsert: (
      values: Record<string, unknown>,
      options: { onConflict: string; ignoreDuplicates: boolean },
    ) => PromiseLike<{ error: InsertError }>
  }
}

export type NotificationPreferenceDefaults = {
  installId: string
  userId: string
  timezone: string
  hideAmounts: boolean
}

/** Insert defaults only when a device has no preference row yet. */
export async function ensureNotificationPreferenceDefaults(
  client: PreferenceInsertClient,
  input: NotificationPreferenceDefaults,
): Promise<void> {
  const { error } = await client.from('mt_notification_preferences').upsert({
    install_id: input.installId,
    user_id: input.userId,
    daily_expense_enabled: true,
    timezone: input.timezone,
    hide_amounts_in_notification: input.hideAmounts,
  }, {
    onConflict: 'install_id',
    ignoreDuplicates: true,
  })
  if (error) throw new Error(error.message)
}
