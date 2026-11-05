// @typebot.io/react ships no usable type declarations (its package.json "types"
// path does not exist in the published dist), so we declare the surface we use.
declare module '@typebot.io/react' {
  import type { CSSProperties, FC } from 'react'

  export type ButtonSize = 'medium' | 'large' | (string & {})

  export interface TypebotTheme {
    position?: 'fixed' | 'static'
    button?: {
      backgroundColor?: string
      iconColor?: string
      customIconSrc?: string
      size?: ButtonSize
      shadow?: string
    }
    chatWindow?: {
      backgroundColor?: string
      width?: string
      height?: string
      maxWidth?: string
      maxHeight?: string
      borderRadius?: string
      shadow?: string
      backdrop?: { backgroundColor?: string; blur?: string }
    }
    header?: {
      backgroundColor?: string
      textColor?: string
      closeIconColor?: string
      fontFamily?: string
      borderRadius?: string
    }
    chat?: {
      backgroundColor?: string
      hostBubbles?: { backgroundColor?: string; color?: string }
      guestBubbles?: { backgroundColor?: string; color?: string }
      buttons?: { backgroundColor?: string; color?: string }
      inputs?: {
        backgroundColor?: string
        color?: string
        placeholderColor?: string
        borderRadius?: string
        shadow?: string
      }
    }
    footer?: { backgroundColor?: string; color?: string; textColor?: string }
    feedback?: { backgroundColor?: string; color?: string }
  }

  export interface BubbleProps {
    typebot: string
    apiHost?: string
    theme?: TypebotTheme
    onNewMessage?: (messages: unknown[]) => void
    onEnd?: () => void
    prefilledVariables?: Record<string, unknown>
    autoShowDelay?: number
    isPreview?: boolean
    storage?: 'session' | 'local' | 'memory'
    rememberUser?: boolean
    style?: CSSProperties
    className?: string
  }

  export const Bubble: FC<BubbleProps>

  export interface StandardProps extends BubbleProps {}
  export const Standard: FC<StandardProps>

  export interface PopupProps extends BubbleProps {}
  export const Popup: FC<PopupProps>

  export const open: (options?: { id?: string }) => void
  export const close: (options?: { id?: string }) => void
  export const toggle: (options?: { id?: string }) => void
  export const reset: (options?: { id?: string }) => void
  export const reload: (options?: { id?: string }) => void
  export const unmount: (options?: { id?: string }) => void
  export const sendCommand: (text: string, options?: { id?: string }) => void
  export const setInputValue: (value: string, options?: { id?: string }) => void
  export const setPrefilledVariables: (variables: Record<string, unknown>, options?: { id?: string }) => void
  export const showPreviewMessage: (message: unknown, options?: { id?: string }) => void
  export const hidePreviewMessage: (options?: { id?: string }) => void
  export const submitInput: (options?: { id?: string }) => void
  export const resolveButtonSize: (size?: ButtonSize) => string
}
