import type { GoogleCredentialResponse } from "@/lib/auth/google-identity";

type GoogleIdentityCallback = (response: GoogleCredentialResponse) => void | Promise<void>;

type GoogleIdentityButtonConfig = {
  type?: "standard" | "icon";
  theme?: "outline" | "filled_blue" | "filled_black";
  size?: "large" | "medium" | "small";
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
  shape?: "rectangular" | "pill" | "circle" | "square";
  logo_alignment?: "left" | "center";
  width?: string | number;
};

type GoogleIdentityInitializeConfig = {
  client_id: string;
  callback: GoogleIdentityCallback;
  ux_mode?: "popup" | "redirect";
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
  nonce?: string;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: GoogleIdentityInitializeConfig) => void;
          renderButton: (parent: HTMLElement, options: GoogleIdentityButtonConfig) => void;
          disableAutoSelect?: () => void;
          prompt?: () => void;
        };
      };
    };
  }
}

export {};
