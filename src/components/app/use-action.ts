'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import type { ActionResult } from '@/lib/types'

/**
 * Small helper around Server Action calls: tracks per-key pending state and
 * renders the action's error string as a toast. Returns the unwrapped data
 * on success, or null on failure.
 */
export function useAction() {
  const [pending, setPending] = useState<Record<string, boolean>>({})

  const run = useCallback(
    async <T,>(
      key: string,
      fn: () => Promise<ActionResult<T>>,
      options?: {
        onSuccess?: (data: T) => void
        successMessage?: string
      },
    ): Promise<T | null> => {
      setPending((prev) => ({ ...prev, [key]: true }))
      try {
        const result = await fn()
        if (!result.ok) {
          toast.error(result.error)
          return null
        }
        if (options?.successMessage) {
          toast.success(options.successMessage)
        }
        options?.onSuccess?.(result.data)
        return result.data
      } finally {
        setPending((prev) => ({ ...prev, [key]: false }))
      }
    },
    [],
  )

  const isPending = useCallback((key: string) => pending[key] ?? false, [pending])

  return { run, isPending }
}
