import { UnistylesRuntime } from "react-native-unistyles";
import { resolveSyntaxColors, type SyntaxThemeId } from "@getpaseo/highlight";
import type { DisplayDensity } from "@/hooks/use-settings/storage";
import {
  DEFAULT_UI_FONT_STACK,
  DEFAULT_MONO_FONT_STACK,
  FONT_SIZE,
  SPACING,
  type Theme,
} from "@/styles/theme";
import { applyRootUiFont } from "./apply-root-font";

// All registered Unistyles keys — pinned literal (greppable, type-checked).
// The `as const` element types stay assignable to
// `UnistylesRuntime.updateTheme`'s first argument as themes are added.
const ALL_THEME_KEYS = [
  "light",
  "dark",
  "darkZinc",
  "darkMidnight",
  "darkClaude",
  "darkGhostty",
  "darkPureBlack",
] as const;

// The UI font size at which the FONT_SIZE ramp is authored (1.0 scale factor).
const BASE_UI_REFERENCE = FONT_SIZE.base; // 16

// Scale factor applied to the SPACING ramp per display density. Single source of truth
// for the density setting; `applyAppearance` always derives from these (and the authored
// ramps), never from live theme values, so repeats never compound. Density deliberately
// does NOT scale fontSize — type size belongs to the dedicated uiFontSize/codeFontSize
// settings; density only tightens space (gaps, paddings, margins).
const DENSITY_SCALE: Record<DisplayDensity, number> = {
  comfortable: 1,
  compact: 0.9,
  ultra: 0.8,
};

export interface AppearanceInput {
  uiFontFamily: string; // "" -> default stack
  monoFontFamily: string; // "" -> default stack
  uiFontSize: number; // already clamped
  codeFontSize: number; // already clamped
  syntaxTheme: SyntaxThemeId;
  /** Optional — defaults to "comfortable" (1.0) when absent, so existing callers stay valid. */
  displayDensity?: DisplayDensity;
}

/**
 * Build the font-size ramp from the canonical `FONT_SIZE` ramp, scaled
 * proportionally by `uiSize / 16` so the type hierarchy is preserved
 * at non-default sizes. Deriving from the authored ramp — NOT the live
 * (possibly already-scaled) theme — makes `applyAppearance` idempotent: repeated applies
 * never compound, and a code-size change (uiSize unchanged) leaves the UI ramp at its
 * authored values.
 * `code` is set absolutely to `codeSize`, never scaled by the UI factor — a separate
 * control on a separate semantic axis (mono/diff text).
 * Display density is intentionally not applied here: it scales spacing only.
 */
function scaleFontSize(uiSize: number, codeSize: number): Theme["fontSize"] {
  const r = uiSize / BASE_UI_REFERENCE;
  return {
    xs: Math.round(FONT_SIZE.xs * r),
    sm: Math.round(FONT_SIZE.sm * r),
    base: Math.round(FONT_SIZE.base * r),
    lg: Math.round(FONT_SIZE.lg * r),
    xl: Math.round(FONT_SIZE.xl * r),
    "2xl": Math.round(FONT_SIZE["2xl"] * r),
    "3xl": Math.round(FONT_SIZE["3xl"] * r),
    "4xl": Math.round(FONT_SIZE["4xl"] * r),
    code: codeSize, // absolute, NOT scaled
  };
}

/**
 * Build the spacing ramp from the canonical `SPACING` ramp, scaled proportionally by
 * `densityFactor`. Same idempotence rule as `scaleFontSize`: always derived from the
 * authored ramp, never from the live (possibly already-scaled) theme.
 */
function scaleSpacing(densityFactor: number): Theme["spacing"] {
  return {
    0: Math.round(SPACING[0] * densityFactor),
    0.5: Math.round(SPACING[0.5] * densityFactor),
    1: Math.round(SPACING[1] * densityFactor),
    1.5: Math.round(SPACING[1.5] * densityFactor),
    2: Math.round(SPACING[2] * densityFactor),
    3: Math.round(SPACING[3] * densityFactor),
    4: Math.round(SPACING[4] * densityFactor),
    6: Math.round(SPACING[6] * densityFactor),
    8: Math.round(SPACING[8] * densityFactor),
    12: Math.round(SPACING[12] * densityFactor),
    16: Math.round(SPACING[16] * densityFactor),
    20: Math.round(SPACING[20] * densityFactor),
    24: Math.round(SPACING[24] * densityFactor),
    32: Math.round(SPACING[32] * densityFactor),
  };
}

/**
 * Patch every registered Unistyles theme with the user's appearance choices.
 * All keys in `ALL_THEME_KEYS` are patched because the active theme can change
 * and adaptive mode can flip light/dark — patching all keys keeps the active key
 * always current and makes ordering vs `setTheme`/`setAdaptiveThemes` irrelevant.
 *
 * The updater preserves the active theme wholesale (surfaces, accents,
 * terminal) and only patches the font ramp and syntax palette.
 * `updateTheme` replaces the stored theme rather than merging, so we spread
 * `...t` first.
 */
export function applyAppearance(input: AppearanceInput): void {
  const ui = input.uiFontFamily.trim() || DEFAULT_UI_FONT_STACK;
  const mono = input.monoFontFamily.trim() || DEFAULT_MONO_FONT_STACK;
  const diffLineHeight = Math.round(input.codeFontSize * 1.5); // couple to code size
  const densityFactor = DENSITY_SCALE[input.displayDensity ?? "comfortable"];
  const activeTheme = UnistylesRuntime.themeName;
  // Unistyles web emits after each registry patch. Updating the mounted theme
  // first ensures subscribers receive its new numeric tokens in this render;
  // updating it last makes Pure black appear one committed value behind.
  const themeKeys = activeTheme
    ? [activeTheme, ...ALL_THEME_KEYS.filter((key) => key !== activeTheme)]
    : ALL_THEME_KEYS;

  for (const key of themeKeys) {
    UnistylesRuntime.updateTheme(key, (t) => {
      const fontFamily = { ui, mono };
      const fontSize = scaleFontSize(input.uiFontSize, input.codeFontSize);
      const spacing = scaleSpacing(densityFactor);
      const lineHeight = { ...t.lineHeight, diff: diffLineHeight };
      if (t.colorScheme === "light") {
        return {
          ...t,
          fontFamily,
          fontSize,
          spacing,
          lineHeight,
          colors: { ...t.colors, syntax: resolveSyntaxColors(input.syntaxTheme, t.colorScheme) },
        };
      }
      return {
        ...t,
        fontFamily,
        fontSize,
        spacing,
        lineHeight,
        colors: { ...t.colors, syntax: resolveSyntaxColors(input.syntaxTheme, t.colorScheme) },
      };
    });
  }

  // Web: apply the UI font app-wide (RN-web stamps a default font on every text
  // element, so it can't be done through the theme alone). No-op on native.
  applyRootUiFont(ui);
}
