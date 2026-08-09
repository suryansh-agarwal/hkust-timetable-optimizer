# shadcn Adoption — Stage 1: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install shadcn/ui, replace the app's hand-rolled theme with shadcn's token system on a slate base with HKUST navy as primary, and move dark mode from a media query to a class-based toggle — without breaking any of the 237 existing inline styles.

**Architecture:** shadcn's `init` appends to `globals.css` rather than replacing it, so after installation the file carries two competing theme mechanisms. This stage reconciles them into one. The 237 inline styles keep working through a compatibility alias block that points the app's legacy token names at shadcn's tokens; later stages delete aliases as they migrate each file. Three legacy names collide with shadcn semantics and are rewritten at their call sites instead of aliased.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4 (CSS-first `@theme inline`), shadcn/ui with the `base-nova` style over `@base-ui/react`, `next-themes`.

**Design spec:** `docs/superpowers/specs/2026-08-09-shadcn-redesign-design.md`

## Global Constraints

- Nothing may visually break. The app has **237 inline `style={{}}` blocks across 9 files** and zero Tailwind classNames; they must keep rendering throughout this stage.
- The primitive library is **`@base-ui/react`**, not Radix. Generated components import from `@base-ui/react/*`. Do not install Radix.
- Colours are **OKLCH** in `:root` and `.dark`. Never introduce a hex or named colour into a component; use `var(--token)`.
- **Subject hues stay as HSL triplets.** `--sub-1`…`--sub-8` and `--cmp-a`/`--cmp-b` are consumed as `hsl(var(--sub-1) / 0.16)` in `TimetableGrid.tsx`. Converting them to OKLCH is stage 4. Do not touch `TimetableGrid.tsx` in this stage.
- Dark mode is the `.dark` class via `next-themes`, defaulting to `system`. The `@media (prefers-color-scheme: dark)` block is removed, not kept alongside.
- Do not migrate any component to shadcn primitives. That is stage 2. The only generated component present is an unused `components/ui/button.tsx`, which stays as installed.
- Python backend is untouched: `api/` tests must remain at 74 passing.

---

### Task 1: Install shadcn and commit the raw CLI output

**Files:**
- Create: `web/components.json`, `web/lib/utils.ts`, `web/components/ui/button.tsx`
- Modify: `web/app/globals.css`, `web/package.json`, `web/package-lock.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `cn(...inputs: ClassValue[]): string` from `@/lib/utils`; shadcn tokens in `globals.css`; the dependencies later stages import.

Committing the CLI's raw output on its own keeps the machine-generated diff separate from the hand-written reconciliation in Task 2. Reviewing them together would mean reading 372 lines of generated CSS to find our edits.

- [ ] **Step 1: Run init**

```bash
cd web && npx shadcn@latest init --yes --defaults
```

Expected output: it detects Next.js, detects Tailwind v4, writes `components.json`, installs dependencies, creates `components/ui/button.tsx` and `lib/utils.ts`, and updates `app/globals.css`.

- [ ] **Step 2: Confirm what it installed**

```bash
cd web && node -e "const p=require('./package.json');console.log(Object.keys(p.dependencies).join('\n'))"
```

Expected to include `@base-ui/react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `tw-animate-css`, and `shadcn`.

`shadcn` appearing in `dependencies` rather than `devDependencies` is correct and intentional: the generated `globals.css` does `@import "shadcn/tailwind.css"`, so it is needed at build time. Do not move it.

- [ ] **Step 3: Set the base colour to slate**

`init` writes `"baseColor": "neutral"`. Neutral is chroma-0 grey and sits badly against a navy primary. Edit `web/components.json`:

```json
  "tailwind": {
    "config": "",
    "css": "app/globals.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
```

Change only that one value. This records the choice for components added in later stages; Task 2 writes the actual palette.

- [ ] **Step 4: Confirm the two-theme-mechanism situation exists**

```bash
cd web && grep -nE "@custom-variant dark|^\.dark|prefers-color-scheme|--sub-1|@import" app/globals.css
```

Expected: `@custom-variant dark (&:is(.dark *))` near the top, a `.dark {` block, **and** the pre-existing `@media (prefers-color-scheme: dark)` block, **and** the pre-existing `--sub-1`. This confirms init appended rather than replaced, which is what Task 2 fixes. Record the line count — it should be roughly 372, up from 208.

- [ ] **Step 5: Commit**

```bash
git add web/components.json web/lib/utils.ts web/components/ui/button.tsx web/app/globals.css web/package.json web/package-lock.json
git commit -m "chore(web): run shadcn init

Raw CLI output, committed separately from the theme reconciliation so the
generated CSS is not interleaved with hand-written changes. globals.css
currently carries two theme mechanisms; the next commit resolves that."
```

Do not run a build yet. The file is in a knowingly inconsistent state until Task 2.

---

### Task 2: Reconcile the theme into one mechanism

**Files:**
- Modify: `web/app/globals.css` (rewritten in full)
- Modify: `web/app/(app)/page.tsx` (4 occurrences)
- Modify: `web/app/login/page.tsx` (3 occurrences)
- Modify: `web/app/request-access/page.tsx` (5 occurrences)

**Interfaces:**
- Consumes: the shadcn tokens installed by Task 1.
- Produces: `:root` and `.dark` blocks carrying the full shadcn token set on a slate base with navy primary; a compatibility alias block mapping every legacy token name onto them. Task 3 relies on `.dark` being the only dark-mode mechanism.

**Why the call-site edits belong in this task and not a separate one:** `--accent`, `--accent-hover` and `--accent-fg` mean "the brand button colour" in this app, but shadcn defines `--accent` as a *light grey hover surface*. Aliasing our name onto shadcn's would make every primary button pale grey. Aliasing shadcn's onto ours would make every future component's hover state navy. Neither works, so the 12 call sites move to `--primary` — and they must move in the same commit that removes the old definitions, or the app renders with transparent buttons in between.

- [ ] **Step 1: Rewrite `web/app/globals.css`**

Replace the entire file with:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

/* shadcn's class-based dark mode. next-themes puts .dark on <html>. */
@custom-variant dark (&:is(.dark *));

/*
 * Theme tokens.
 *
 * Two groups live here. The shadcn set (--background, --card, --primary and
 * friends) is what generated components consume. The legacy set (--surface,
 * --text-muted and friends) is what this app's 237 inline styles consume; it
 * is defined purely as aliases onto the shadcn set, and each alias is deleted
 * as its consumers migrate in later stages.
 *
 * Base palette is shadcn "slate", chosen over neutral because the primary is
 * HKUST navy and a chroma-0 grey sits badly against it.
 */
:root {
  --radius: 0.625rem;

  --background: oklch(1.0000 0.0000 89.88);
  --foreground: oklch(0.1371 0.0360 258.53);
  --card: oklch(1.0000 0.0000 89.88);
  --card-foreground: oklch(0.1371 0.0360 258.53);
  --popover: oklch(1.0000 0.0000 89.88);
  --popover-foreground: oklch(0.1371 0.0360 258.53);

  /* HKUST navy #003366 */
  --primary: oklch(0.3233 0.1025 253.89);
  --primary-foreground: oklch(0.9838 0.0035 247.86);
  --primary-hover: oklch(0.3900 0.1025 253.89);

  --secondary: oklch(0.9684 0.0068 247.90);
  --secondary-foreground: oklch(0.2079 0.0399 265.73);
  --muted: oklch(0.9684 0.0068 247.90);
  --muted-foreground: oklch(0.5547 0.0407 257.44);
  --accent: oklch(0.9684 0.0068 247.90);
  --accent-foreground: oklch(0.2079 0.0399 265.73);
  --destructive: oklch(0.6368 0.2078 25.33);
  --destructive-foreground: oklch(0.9838 0.0035 247.86);
  --border: oklch(0.9290 0.0126 255.53);
  --input: oklch(0.9290 0.0126 255.53);
  --ring: oklch(0.3233 0.1025 253.89);

  --success: oklch(0.5500 0.1400 150.00);
  --warn-bg: oklch(0.9500 0.0700 90.00);
  --warn-text: oklch(0.4500 0.1000 70.00);

  --overlay: oklch(0 0 0 / 0.35);
  --shadow-sm: 0 1px 3px oklch(0 0 0 / 0.08);
  --shadow-md: 0 2px 10px oklch(0 0 0 / 0.08);
  --shadow-lg: 0 12px 30px oklch(0 0 0 / 0.20);

  --login-canvas: linear-gradient(135deg, oklch(0.9800 0.0040 250) 0%, oklch(0.9550 0.0090 255) 100%);
  --login-badge: oklch(0.2079 0.0399 265.73);

  /*
   * Subject hues stay as HSL triplets. TimetableGrid derives fill, border and
   * label with hsl(var(--sub-N) / alpha); converting them to OKLCH means
   * changing that component, which is stage 4.
   */
  --sub-1: 217 91% 45%;
  --sub-2: 160 84% 30%;
  --sub-3: 347 77% 42%;
  --sub-4: 271 81% 50%;
  --sub-5: 21 90% 42%;
  --sub-6: 192 82% 32%;
  --sub-7: 239 84% 55%;
  --sub-8: 38 92% 38%;
  --cmp-a: 0 84% 55%;
  --cmp-b: 217 91% 55%;

  /* --- Legacy aliases. Deleted per-file as later stages migrate. --- */
  --bg: var(--background);
  --surface: var(--card);
  --surface-2: var(--muted);
  --surface-3: var(--muted);
  --border-subtle: var(--border);
  --border-faint: var(--border);
  --text: var(--foreground);
  --text-strong: var(--foreground);
  --text-body: var(--foreground);
  --text-muted: var(--muted-foreground);
  --text-subtle: var(--muted-foreground);
  --text-faint: var(--muted-foreground);
  --danger: var(--destructive);
  /* Tinted, not flat --muted: these back the error and success panels, and
     mapping them to plain grey would silently drain the colour out of every
     failure state in the app. color-mix keeps them theme-aware. */
  --danger-bg: color-mix(in oklch, var(--destructive) 10%, var(--background));
  --danger-border: color-mix(in oklch, var(--destructive) 30%, var(--background));
  --danger-chip-bg: color-mix(in oklch, var(--destructive) 8%, var(--background));
  --success-bg: color-mix(in oklch, var(--success) 10%, var(--background));
  --success-border: color-mix(in oklch, var(--success) 30%, var(--background));
  --pin-bg: color-mix(in oklch, var(--primary) 12%, var(--background));
  --pin-border: var(--primary);
  --pin-text: var(--primary);
  --selected-bg: color-mix(in oklch, var(--primary) 8%, var(--background));
  --active-border: var(--primary);
}

.dark {
  --background: oklch(0.1371 0.0360 258.53);
  --foreground: oklch(0.9838 0.0035 247.86);
  --card: oklch(0.2000 0.0350 259.00);
  --card-foreground: oklch(0.9838 0.0035 247.86);
  --popover: oklch(0.2000 0.0350 259.00);
  --popover-foreground: oklch(0.9838 0.0035 247.86);

  /* Lightened navy. #003366 is unreadable on a dark surface. */
  --primary: oklch(0.5324 0.1214 251.48);
  --primary-foreground: oklch(0.9838 0.0035 247.86);
  --primary-hover: oklch(0.6000 0.1214 251.48);

  --secondary: oklch(0.2800 0.0369 259.97);
  --secondary-foreground: oklch(0.9838 0.0035 247.86);
  --muted: oklch(0.2800 0.0369 259.97);
  --muted-foreground: oklch(0.7107 0.0351 256.79);
  --accent: oklch(0.2800 0.0369 259.97);
  --accent-foreground: oklch(0.9838 0.0035 247.86);
  --destructive: oklch(0.6000 0.1900 25.50);
  --destructive-foreground: oklch(0.9838 0.0035 247.86);
  --border: oklch(0.2800 0.0369 259.97);
  --input: oklch(0.2800 0.0369 259.97);
  --ring: oklch(0.8688 0.0198 252.85);

  --success: oklch(0.7200 0.1600 150.00);
  --warn-bg: oklch(0.3000 0.0600 80.00);
  --warn-text: oklch(0.8500 0.1400 85.00);

  --overlay: oklch(0 0 0 / 0.60);
  --shadow-sm: 0 1px 3px oklch(0 0 0 / 0.50);
  --shadow-md: 0 2px 12px oklch(0 0 0 / 0.55);
  --shadow-lg: 0 12px 30px oklch(0 0 0 / 0.60);

  --login-canvas: linear-gradient(135deg, oklch(0.1371 0.0360 258.53) 0%, oklch(0.2000 0.0350 259) 100%);
  --login-badge: oklch(0.2800 0.0369 259.97);

  --sub-1: 217 91% 70%;
  --sub-2: 160 70% 55%;
  --sub-3: 347 85% 70%;
  --sub-4: 271 85% 75%;
  --sub-5: 21 90% 65%;
  --sub-6: 192 75% 60%;
  --sub-7: 239 90% 76%;
  --sub-8: 38 92% 62%;
  --cmp-a: 0 90% 70%;
  --cmp-b: 217 91% 70%;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);

  /* This app defines --font-geist-sans in layout.tsx; shadcn's generated
     @theme referenced an undefined --font-sans, so the sans face fell back. */
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);

  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) * 1.4);
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-geist-sans), Arial, Helvetica, sans-serif;
}

dialog::backdrop {
  background: var(--overlay);
}

/* Native controls inherit the surface they sit on. */
input,
select,
textarea,
button {
  font-family: inherit;
  color: var(--foreground);
}

input:not([type="checkbox"]):not([type="radio"]),
select,
textarea {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

input[type="checkbox"],
input[type="radio"] {
  accent-color: var(--primary);
}

input:not([type="checkbox"]):not([type="radio"]):disabled,
select:disabled,
textarea:disabled {
  background: var(--muted);
  color: var(--muted-foreground);
}

input::placeholder {
  color: var(--muted-foreground);
}

:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Note what is deliberately absent: no `@media (prefers-color-scheme: dark)` block, and no `color-scheme` declaration. `next-themes` sets `color-scheme` from the resolved theme in Task 3.

- [ ] **Step 2: Rewrite the colliding call sites**

There are exactly 12, in three files. Replace:

| Old | New |
|---|---|
| `var(--accent)` | `var(--primary)` |
| `var(--accent-fg)` | `var(--primary-foreground)` |
| `var(--accent-hover)` | `var(--primary-hover)` |

```bash
cd web && for f in "app/(app)/page.tsx" app/login/page.tsx app/request-access/page.tsx; do
  perl -pi -e 's/var\(--accent-fg\)/var(--primary-foreground)/g; s/var\(--accent-hover\)/var(--primary-hover)/g; s/var\(--accent\)/var(--primary)/g' "$f"
done
```

Order matters in that substitution: `--accent-fg` and `--accent-hover` are replaced before the bare `--accent`, otherwise the prefix match would corrupt them.

- [ ] **Step 3: Verify no legacy token is left undefined**

Every `var(--x)` used in a component must resolve. This finds any that do not:

```bash
cd web && comm -23 \
  <(grep -rho "var(--[a-z0-9-]*)" app --include="*.tsx" | sed 's/var(--\(.*\))/\1/' | sort -u) \
  <(grep -oE "^\s*--[a-z0-9-]+:" app/globals.css | tr -d ' :' | sort -u)
```

Expected: **no output.** Any line printed is a token a component uses that the stylesheet does not define, which renders as an invalid value.

- [ ] **Step 4: Confirm no `--accent` usage survives and no hex leaked in**

```bash
cd web && grep -rn "var(--accent" app --include="*.tsx" || echo "  no --accent usages remain"
git diff -- app | grep "^+" | grep -oE '#[0-9a-fA-F]{3,8}\b|"white"|"crimson"' | sort -u || echo "  no colour literals introduced"
```

- [ ] **Step 5: Build**

```bash
cd web && rm -rf .next && npx tsc --noEmit && npx eslint "app/(app)/page.tsx" app/login/page.tsx app/request-access/page.tsx && npx vitest run && npx next build
```

Expected: all clean, 17 vitest tests passing.

At this point the app renders in **light mode only** — `.dark` exists but nothing applies it. That is expected; Task 3 wires it up.

- [ ] **Step 6: Commit**

```bash
git add web/app/globals.css "web/app/(app)/page.tsx" web/app/login/page.tsx web/app/request-access/page.tsx
git commit -m "feat(web): reconcile the theme onto shadcn tokens

shadcn init appended its tokens and a .dark block while leaving the old
prefers-color-scheme block in place, so globals.css carried two theme
mechanisms. Rewrites it around one: shadcn's slate palette with HKUST
navy as primary, in OKLCH, plus an alias block that keeps the 237
existing inline styles resolving until later stages migrate them.

--accent could not be aliased: this app means the brand button colour by
it, shadcn means a light hover surface. The 12 call sites move to
--primary instead, in this commit so no intermediate state renders
transparent buttons.

Subject hues stay as HSL triplets because TimetableGrid consumes them
with hsl(); converting those is stage 4."
```

---

### Task 3: Wire up next-themes

**Files:**
- Create: `web/components/theme-provider.tsx`
- Modify: `web/app/layout.tsx`
- Modify: `web/package.json`, `web/package-lock.json`

**Interfaces:**
- Consumes: the `.dark` block from Task 2.
- Produces: `<ThemeProvider>` wrapping the app, and `useTheme()` from `next-themes` available to any client component. Task 4 uses `useTheme`.

- [ ] **Step 1: Install**

```bash
cd web && npm install next-themes
```

- [ ] **Step 2: Create the provider**

Create `web/components/theme-provider.tsx`:

```tsx
"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
```

It exists only to mark the boundary: `next-themes` is a client component and `layout.tsx` is a server component.

- [ ] **Step 3: Mount it**

Replace the `RootLayout` body in `web/app/layout.tsx`:

```tsx
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning is required, not optional: next-themes sets the
    // class on <html> before React hydrates, so server and client markup
    // differ by design on this one element.
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

Add the import at the top:

```tsx
import { ThemeProvider } from "@/components/theme-provider";
```

`defaultTheme="system"` with `enableSystem` preserves today's behaviour for anyone who never opens the toggle.

- [ ] **Step 4: Verify dark mode actually applies**

```bash
cd web && npx next dev --port 3000
```

In another shell:

```bash
curl -s http://localhost:3000/login | grep -o 'class="[^"]*"' | head -3
```

Then in a browser at `http://localhost:3000/login`, run in the console:

```js
document.documentElement.className
```

Expected: `"light"` or `"dark"` depending on your OS setting — proving `next-themes` is driving the class. Switch your OS appearance and confirm the page follows without a reload.

Also confirm the console shows **no hydration mismatch warning**. If one appears, `suppressHydrationWarning` is missing from `<html>`.

Kill the dev server.

- [ ] **Step 5: Build**

```bash
cd web && npx tsc --noEmit && npx eslint components/theme-provider.tsx app/layout.tsx && npx next build
```

- [ ] **Step 6: Commit**

```bash
git add web/components/theme-provider.tsx web/app/layout.tsx web/package.json web/package-lock.json
git commit -m "feat(web): drive dark mode with next-themes

Replaces the prefers-color-scheme media query removed in the previous
commit. Defaults to system so behaviour is unchanged for anyone who does
not open the toggle. suppressHydrationWarning on <html> is required
because next-themes sets the class before React hydrates."
```

---

### Task 4: Theme toggle

**Files:**
- Create: `web/components/theme-toggle.tsx`
- Modify: `web/app/(app)/page.tsx` (header row; help modal copy)

**Interfaces:**
- Consumes: `useTheme` from `next-themes`, mounted by Task 3.
- Produces: `<ThemeToggle />`, a three-way System / Light / Dark control.

Built with inline styles and the existing tokens, matching the other header buttons. Stage 2 replaces it with a shadcn DropdownMenu; introducing one component's worth of shadcn here would leave a single Tailwind-styled element among 237 inline-styled ones.

- [ ] **Step 1: Create the toggle**

Create `web/components/theme-toggle.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";

const OPTIONS = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // The server cannot know the resolved theme, so rendering the active state
  // before mount would produce a hydration mismatch. Render the frame at the
  // right size and fill it in after.
  useEffect(() => setMounted(true), []);

  return (
    <div
      role="group"
      aria-label="Colour theme"
      style={{
        display: "inline-flex",
        border: "1px solid var(--border)",
        borderRadius: 10,
        overflow: "hidden",
        background: "var(--card)",
      }}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => setTheme(value)}
            aria-pressed={active}
            title={label}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 10px",
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              background: active ? "var(--primary)" : "transparent",
              color: active ? "var(--primary-foreground)" : "var(--muted-foreground)",
            }}
          >
            <Icon size={14} aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Put it in the header**

In `web/app/(app)/page.tsx`, find the header action row containing the Feedback link, the "How to use?" button and the Optimize button. Add the toggle as the first child of that row:

```tsx
          <ThemeToggle />
```

and import it at the top:

```tsx
import { ThemeToggle } from "@/components/theme-toggle";
```

- [ ] **Step 3: Correct the help modal copy**

The help modal currently ends with a line that is now false. Replace:

```
This is a work in progress. Please report any issues or feedback to google form on the top right. The app follows your system light or dark theme.
```

with:

```
This is a work in progress. Please report any issues or feedback to google form on the top right. Use the theme switch in the header to follow your system setting or force light or dark.
```

- [ ] **Step 4: Verify**

```bash
cd web && npx tsc --noEmit && npx eslint components/theme-toggle.tsx "app/(app)/page.tsx" && npx vitest run && npx next build
```

- [ ] **Step 5: Commit**

```bash
git add web/components/theme-toggle.tsx "web/app/(app)/page.tsx"
git commit -m "feat(web): add a System/Light/Dark theme switch

Inline-styled to match the surrounding header controls; stage 2 replaces
it with a shadcn DropdownMenu once the rest of the header migrates. The
active state renders only after mount, since the server cannot know the
resolved theme. Corrects the help text, which claimed the app follows the
system theme with no way to override."
```

---

### Task 5: Verification

**Files:** none modified.

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Full gate**

```bash
cd api && .venv/bin/pytest tests/ -q
cd ../web && rm -rf .next && npx tsc --noEmit && npx eslint . && npx vitest run && npx next build
```

Expected: 74 Python tests, 17 vitest tests, tsc clean, eslint clean, build clean with **no deprecation warnings**.

- [ ] **Step 2: Confirm every token resolves**

```bash
cd web && comm -23 \
  <(grep -rho "var(--[a-z0-9-]*)" app components --include="*.tsx" | sed 's/var(--\(.*\))/\1/' | sort -u) \
  <(grep -oE "^\s*--[a-z0-9-]+:" app/globals.css | tr -d ' :' | sort -u)
```

Expected: no output.

- [ ] **Step 3: Confirm auth still gates**

Task 3 modified the root layout, which is where the provider mounts. Start the dev server on port 3000, then:

```bash
for p in "/" "/login" "/request-access"; do
  printf "  %-18s " "$p"
  curl -s -o /dev/null -w "HTTP %{http_code} -> %{redirect_url}\n" "http://localhost:3000$p"
done
```

Expected: `/` gives 307 to `/login?next=%2F`; `/login` and `/request-access` give 200.

- [ ] **Step 4: Screenshot both themes**

Use the established preview-route method. Create `web/app/preview-tmp/page.tsx`:

```tsx
"use client";
import Home from "../(app)/page";
export default function Preview() { return <Home />; }
```

Temporarily move `web/proxy.ts` aside so the route is reachable, start the API with
`MINICATALOG_PATH="../web/public/course-index/{term}.json"` on port 8000 and the dev
server on port 3000 (the API's CORS allowlist contains `localhost:3000`, so any other
port fails the preflight).

Drive it with Playwright: load `/preview-tmp`, dismiss the help dialog, add `COMP 2011`
and `MATH 1003`, click Optimize, wait for results, and screenshot. Repeat with the
theme toggle set to Light and then to Dark.

Check in each screenshot:
1. Primary buttons are navy in light, lightened navy in dark — not grey, which is what an unresolved `--primary` looks like.
2. Card surfaces are distinguishable from the page background in dark mode.
3. Text is legible everywhere; no dark-on-dark or light-on-light.
4. The timetable grid's subject colours still render — proving the HSL triplets survived.
5. The theme toggle shows the active option.

- [ ] **Step 5: Clean up the preview scaffolding**

```bash
cd web && rm -rf app/preview-tmp .playwright-mcp && git checkout -- proxy.ts 2>/dev/null; git status --short
```

Expected: no modified or untracked files besides the repo's pre-existing `kite-export.mp4`. If `proxy.ts` is missing, restore it from git — a missing proxy silently disables auth.

- [ ] **Step 6: Report**

Do not push. Report results and let the repo owner decide on integration.

---

## Notes for the implementer

- **`init` appends, it does not replace.** Task 1 deliberately leaves `globals.css` inconsistent; Task 2 rewrites the whole file. Do not try to patch the generated output in place.
- **The alias block is load-bearing.** 237 inline styles reference the legacy names. Deleting an alias before its consumers migrate breaks that surface silently — CSS resolves an unknown variable to an invalid value rather than erroring.
- **Do not touch `TimetableGrid.tsx`.** It consumes `hsl(var(--sub-N) / alpha)`, and the triplets are kept in HSL exactly so this stage does not have to.
- **Do not add shadcn components.** That is stage 2. The generated `button.tsx` is unused and stays that way.
- The API's CORS allowlist contains `http://localhost:3000` only. A dev server on any other port fails the `/optimize/ranked` preflight with a 400 and the preview will show no results.
