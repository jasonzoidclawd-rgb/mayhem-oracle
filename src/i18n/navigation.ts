import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// These are locale-aware versions of Next.js navigation APIs.
// Use these instead of next/link, next/navigation throughout the app.
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
