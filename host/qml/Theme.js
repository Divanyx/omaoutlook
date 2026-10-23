.pragma library

// Omarchy theme -> Fluent UI v9 design tokens.
//
// Outlook on the web is built on Fluent UI (v9, with v8 underneath), which paints every
// surface from CSS custom properties such as --colorNeutralBackground1 and
// --colorBrandBackground. Re-defining those properties from the Omarchy theme
// re-skins the whole application without touching a single Outlook selector.
// The mapping below derives every alias token from the handful of colors an
// Omarchy theme ships in colors.toml (background, foreground, accent, the
// dark/light surface variants and the ANSI-ish status colors).
//
// Everything here is plain ECMAScript so it runs both inside the QML engine
// and under node for the unit tests in tests/theme.test.js.

function parseColors(text) {
  var out = {}
  var lines = String(text || "").split("\n")
  for (var i = 0; i < lines.length; i++) {
    var m = lines[i].match(/^\s*([A-Za-z0-9_-]+)\s*=\s*["']([^"']*)["']/)
    if (m) out[m[1]] = m[2].trim()
  }
  return out
}

function isColor(v) {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v)
}

function hexToRgb(hex) {
  var h = String(hex).replace("#", "")
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  if (h.length !== 6) return null
  var n = parseInt(h, 16)
  if (isNaN(n)) return null
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function toHex2(n) {
  var s = Math.max(0, Math.min(255, Math.round(n))).toString(16)
  return s.length < 2 ? "0" + s : s
}

function rgbToHex(c) {
  return "#" + toHex2(c.r) + toHex2(c.g) + toHex2(c.b)
}

// Linear blend from a to b: t = 0 gives a, t = 1 gives b.
function mix(a, b, t) {
  var ca = hexToRgb(a), cb = hexToRgb(b)
  if (!ca || !cb) return a
  t = Math.max(0, Math.min(1, t))
  return rgbToHex({
    r: ca.r + (cb.r - ca.r) * t,
    g: ca.g + (cb.g - ca.g) * t,
    b: ca.b + (cb.b - ca.b) * t
  })
}

function alpha(hex, a) {
  var c = hexToRgb(hex)
  if (!c) return hex
  return "rgba(" + c.r + ", " + c.g + ", " + c.b + ", " + Math.max(0, Math.min(1, a)) + ")"
}

function channel(v) {
  v /= 255
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

// WCAG relative luminance, 0 (black) .. 1 (white).
function luminance(hex) {
  var c = hexToRgb(hex)
  if (!c) return 0
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
}

function contrast(a, b) {
  var la = luminance(a), lb = luminance(b)
  var hi = Math.max(la, lb), lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

// The candidate that reads best on `bg`. Theme colors are tried first so text
// on the accent stays inside the palette; pure black/white are the last resort
// for accents that neither theme color can sit on.
function readableOn(bg, candidates) {
  var best = candidates[0], bestRatio = 0
  for (var i = 0; i < candidates.length; i++) {
    var r = contrast(bg, candidates[i])
    if (r > bestRatio) { best = candidates[i]; bestRatio = r }
    if (i === 1 && bestRatio >= 4.5) break
  }
  return best
}

function pick(v, fallback) {
  return isColor(v) ? v : fallback
}

// Derive the working palette from colors.toml. Fluent's Background2..5 step
// away from Background1 into the "deep" direction in both modes (darker on a
// dark theme, still darker on a light one), which is exactly what Omarchy's
// dark_background / darker_background describe.
function palette(colors) {
  colors = colors || {}
  var mode = String(colors.mode || "dark").toLowerCase() === "light" ? "light" : "dark"
  var dark = mode === "dark"
  var black = "#000000", white = "#ffffff"
  var bg = pick(colors.background, dark ? "#101315" : "#f4f4f4")
  var fg = pick(colors.foreground, dark ? "#cacccc" : "#242424")
  var accent = pick(colors.accent, pick(colors.blue, fg))

  function deep(c, t) { return mix(c, black, t) }
  function raise(c, t) { return mix(c, fg, t) }

  var bg2 = pick(colors.dark_background, deep(bg, dark ? 0.22 : 0.04))
  var bg3 = pick(colors.darker_background, deep(bg2, dark ? 0.22 : 0.04))
  var bg4 = deep(bg3, dark ? 0.2 : 0.04)
  var bg5 = deep(bg4, dark ? 0.2 : 0.04)
  var bg6 = dark ? raise(bg, 0.07) : deep(bg, 0.08)
  var card = dark ? raise(bg, 0.05) : deep(bg, 0.02)

  var fg2 = isColor(colors.light_foreground) && colors.light_foreground.toLowerCase() !== fg.toLowerCase()
    ? colors.light_foreground : mix(fg, bg, 0.18)
  var fg3 = pick(colors.dark_foreground, mix(fg, bg, 0.42))
  var fg4 = mix(fg, bg, 0.55)

  var brandHover = dark ? mix(accent, white, 0.12) : mix(accent, black, 0.12)
  var brandPressed = dark ? mix(accent, white, 0.22) : mix(accent, black, 0.22)
  var brandSoft = dark ? mix(accent, white, 0.2) : mix(accent, black, 0.2)

  return {
    mode: mode, dark: dark,
    bg: bg, bg2: bg2, bg3: bg3, bg4: bg4, bg5: bg5, bg6: bg6, card: card,
    fg: fg, fg2: fg2, fg3: fg3, fg4: fg4,
    disabled: mix(fg, bg, 0.66),
    selection: pick(colors.selection, mix(accent, bg, 0.8)),
    accent: accent, brandHover: brandHover, brandPressed: brandPressed, brandSoft: brandSoft,
    onBrand: readableOn(accent, [bg, fg, black, white]),
    red: pick(colors.red, "#d13438"),
    green: pick(colors.green, "#107c10"),
    yellow: pick(colors.yellow, pick(colors.orange, "#f7630c")),
    orange: pick(colors.orange, pick(colors.yellow, "#f7630c")),
    blue: pick(colors.blue, accent),
    magenta: pick(colors.magenta, pick(colors.purple, "")) || null,
    raise: raise, deep: deep
  }
}

function pickPurple(p) {
  return p.magenta || mix(p.red, p.blue, 0.5)
}

function tokens(p) {
  var t = {}
  var fg = p.fg, bg = p.bg, accent = p.accent
  var raise = p.raise

  // --- neutral foreground ------------------------------------------------
  t.colorNeutralForeground1 = fg
  t.colorNeutralForeground1Hover = fg
  t.colorNeutralForeground1Pressed = fg
  t.colorNeutralForeground1Selected = fg
  t.colorNeutralForeground2 = p.fg2
  t.colorNeutralForeground2Hover = fg
  t.colorNeutralForeground2Pressed = fg
  t.colorNeutralForeground2Selected = fg
  t.colorNeutralForeground2BrandHover = accent
  t.colorNeutralForeground2BrandPressed = p.brandPressed
  t.colorNeutralForeground2BrandSelected = accent
  t.colorNeutralForeground3 = p.fg3
  t.colorNeutralForeground3Hover = p.fg2
  t.colorNeutralForeground3Pressed = p.fg2
  t.colorNeutralForeground3Selected = p.fg2
  t.colorNeutralForeground3BrandHover = accent
  t.colorNeutralForeground3BrandPressed = p.brandPressed
  t.colorNeutralForeground3BrandSelected = accent
  t.colorNeutralForeground4 = p.fg4
  t.colorNeutralForeground5 = p.fg4
  t.colorNeutralForeground5Hover = p.fg3
  t.colorNeutralForeground5Pressed = p.fg3
  t.colorNeutralForeground5Selected = p.fg3
  t.colorNeutralForegroundDisabled = p.disabled
  t.colorNeutralForegroundInvertedDisabled = alpha(bg, 0.4)
  t.colorNeutralForeground1Static = fg
  t.colorNeutralForegroundInverted = bg
  t.colorNeutralForegroundInvertedHover = bg
  t.colorNeutralForegroundInvertedPressed = bg
  t.colorNeutralForegroundInvertedSelected = bg
  t.colorNeutralForegroundInverted2 = bg
  t.colorNeutralForegroundOnBrand = p.onBrand
  t.colorNeutralForegroundStaticInverted = "#ffffff"
  t.colorNeutralForegroundInvertedLink = bg
  t.colorNeutralForegroundInvertedLinkHover = bg
  t.colorNeutralForegroundInvertedLinkPressed = bg
  t.colorNeutralForegroundInvertedLinkSelected = bg

  // --- brand foreground ----------------------------------------------------
  t.colorBrandForegroundLink = accent
  t.colorBrandForegroundLinkHover = p.brandHover
  t.colorBrandForegroundLinkPressed = p.brandPressed
  t.colorBrandForegroundLinkSelected = accent
  t.colorNeutralForeground2Link = p.fg2
  t.colorNeutralForeground2LinkHover = fg
  t.colorNeutralForeground2LinkPressed = fg
  t.colorNeutralForeground2LinkSelected = fg
  t.colorCompoundBrandForeground1 = accent
  t.colorCompoundBrandForeground1Hover = p.brandHover
  t.colorCompoundBrandForeground1Pressed = p.brandPressed
  t.colorBrandForeground1 = accent
  t.colorBrandForeground2 = p.brandSoft
  t.colorBrandForeground2Hover = p.brandHover
  t.colorBrandForeground2Pressed = p.brandPressed
  t.colorBrandForegroundInverted = accent
  t.colorBrandForegroundInvertedHover = p.brandHover
  t.colorBrandForegroundInvertedPressed = p.brandPressed
  t.colorBrandForegroundOnLight = accent
  t.colorBrandForegroundOnLightHover = p.brandHover
  t.colorBrandForegroundOnLightPressed = p.brandPressed
  t.colorBrandForegroundOnLightSelected = accent

  // --- neutral background --------------------------------------------------
  function surface(name, base) {
    t["colorNeutralBackground" + name] = base
    t["colorNeutralBackground" + name + "Hover"] = raise(base, 0.05)
    t["colorNeutralBackground" + name + "Pressed"] = raise(base, 0.09)
    t["colorNeutralBackground" + name + "Selected"] = raise(base, 0.07)
  }
  surface("1", bg)
  surface("2", p.bg2)
  surface("3", p.bg3)
  surface("4", p.bg4)
  surface("5", p.bg5)
  t.colorNeutralBackground6 = p.bg6
  surface("7", p.bg6)
  t.colorNeutralBackground8 = p.bg6
  t.colorNeutralBackgroundInverted = mix(fg, bg, 0.08)
  t.colorNeutralBackgroundInvertedHover = mix(fg, bg, 0.14)
  t.colorNeutralBackgroundInvertedPressed = mix(fg, bg, 0.2)
  t.colorNeutralBackgroundInvertedSelected = mix(fg, bg, 0.16)
  t.colorNeutralBackgroundStatic = raise(bg, 0.15)
  t.colorNeutralBackgroundAlpha = alpha(bg, 0.5)
  t.colorNeutralBackgroundAlpha2 = alpha(bg, 0.8)
  t.colorSubtleBackground = "transparent"
  t.colorSubtleBackgroundHover = alpha(fg, 0.08)
  t.colorSubtleBackgroundPressed = alpha(fg, 0.12)
  t.colorSubtleBackgroundSelected = p.selection
  t.colorSubtleBackgroundLightAlphaHover = alpha(fg, 0.08)
  t.colorSubtleBackgroundLightAlphaPressed = alpha(fg, 0.12)
  t.colorSubtleBackgroundLightAlphaSelected = "transparent"
  t.colorSubtleBackgroundInverted = "transparent"
  t.colorSubtleBackgroundInvertedHover = alpha(bg, 0.1)
  t.colorSubtleBackgroundInvertedPressed = alpha(bg, 0.3)
  t.colorSubtleBackgroundInvertedSelected = alpha(bg, 0.2)
  t.colorTransparentBackground = "transparent"
  t.colorTransparentBackgroundHover = alpha(fg, 0.06)
  t.colorTransparentBackgroundPressed = alpha(fg, 0.1)
  t.colorTransparentBackgroundSelected = alpha(fg, 0.08)
  t.colorNeutralBackgroundDisabled = raise(bg, 0.06)
  t.colorNeutralBackgroundDisabled2 = raise(bg, 0.03)
  t.colorNeutralBackgroundInvertedDisabled = alpha(bg, 0.1)
  t.colorNeutralStencil1 = raise(bg, 0.12)
  t.colorNeutralStencil2 = raise(bg, 0.06)
  t.colorNeutralStencil1Alpha = alpha(fg, 0.12)
  t.colorNeutralStencil2Alpha = alpha(fg, 0.06)
  t.colorBackgroundOverlay = "rgba(0, 0, 0, 0.5)"
  t.colorScrollbarOverlay = alpha(fg, 0.35)

  // --- brand background ----------------------------------------------------
  t.colorBrandBackground = accent
  t.colorBrandBackgroundHover = p.brandHover
  t.colorBrandBackgroundPressed = p.brandPressed
  t.colorBrandBackgroundSelected = p.brandHover
  t.colorCompoundBrandBackground = accent
  t.colorCompoundBrandBackgroundHover = p.brandHover
  t.colorCompoundBrandBackgroundPressed = p.brandPressed
  t.colorBrandBackgroundStatic = accent
  t.colorBrandBackground2 = mix(accent, bg, 0.82)
  t.colorBrandBackground2Hover = mix(accent, bg, 0.75)
  t.colorBrandBackground2Pressed = mix(accent, bg, 0.68)
  t.colorBrandBackground3Static = mix(accent, bg, 0.5)
  t.colorBrandBackground4Static = mix(accent, bg, 0.3)
  t.colorBrandBackgroundInverted = bg
  t.colorBrandBackgroundInvertedHover = mix(bg, accent, 0.1)
  t.colorBrandBackgroundInvertedPressed = mix(bg, accent, 0.2)
  t.colorBrandBackgroundInvertedSelected = mix(bg, accent, 0.15)
  t.colorNeutralCardBackground = p.card
  t.colorNeutralCardBackgroundHover = raise(p.card, 0.05)
  t.colorNeutralCardBackgroundPressed = raise(p.card, 0.09)
  t.colorNeutralCardBackgroundSelected = raise(p.card, 0.07)
  t.colorNeutralCardBackgroundDisabled = p.card

  // --- strokes -------------------------------------------------------------
  t.colorNeutralStrokeAccessible = mix(fg, bg, 0.45)
  t.colorNeutralStrokeAccessibleHover = mix(fg, bg, 0.35)
  t.colorNeutralStrokeAccessiblePressed = mix(fg, bg, 0.3)
  t.colorNeutralStrokeAccessibleSelected = accent
  t.colorNeutralStroke1 = mix(fg, bg, 0.74)
  t.colorNeutralStroke1Hover = mix(fg, bg, 0.66)
  t.colorNeutralStroke1Pressed = mix(fg, bg, 0.62)
  t.colorNeutralStroke1Selected = mix(fg, bg, 0.66)
  t.colorNeutralStroke2 = mix(fg, bg, 0.82)
  t.colorNeutralStroke3 = mix(fg, bg, 0.88)
  t.colorNeutralStroke4 = mix(fg, bg, 0.92)
  t.colorNeutralStroke4Hover = mix(fg, bg, 0.9)
  t.colorNeutralStroke4Pressed = mix(fg, bg, 0.88)
  t.colorNeutralStroke4Selected = mix(fg, bg, 0.9)
  t.colorNeutralStrokeSubtle = mix(fg, bg, 0.82)
  t.colorNeutralStrokeOnBrand = bg
  t.colorNeutralStrokeOnBrand2 = p.onBrand
  t.colorNeutralStrokeOnBrand2Hover = p.onBrand
  t.colorNeutralStrokeOnBrand2Pressed = p.onBrand
  t.colorNeutralStrokeOnBrand2Selected = p.onBrand
  t.colorBrandStroke1 = accent
  t.colorBrandStroke2 = mix(accent, bg, 0.5)
  t.colorBrandStroke2Hover = mix(accent, bg, 0.4)
  t.colorBrandStroke2Pressed = mix(accent, bg, 0.3)
  t.colorBrandStroke2Contrast = mix(accent, bg, 0.6)
  t.colorCompoundBrandStroke = accent
  t.colorCompoundBrandStrokeHover = p.brandHover
  t.colorCompoundBrandStrokePressed = p.brandPressed
  t.colorNeutralStrokeDisabled = mix(fg, bg, 0.85)
  t.colorNeutralStrokeDisabled2 = mix(fg, bg, 0.9)
  t.colorNeutralStrokeInvertedDisabled = alpha(bg, 0.4)
  t.colorTransparentStroke = "transparent"
  t.colorTransparentStrokeInteractive = "transparent"
  t.colorTransparentStrokeDisabled = "transparent"
  t.colorNeutralStrokeAlpha = alpha(fg, 0.1)
  t.colorNeutralStrokeAlpha2 = alpha(fg, 0.2)
  t.colorStrokeFocus1 = bg
  t.colorStrokeFocus2 = accent

  // --- status --------------------------------------------------------------
  function status(name, color, extraDanger) {
    t["colorStatus" + name + "Background1"] = mix(color, bg, 0.85)
    t["colorStatus" + name + "Background2"] = mix(color, bg, 0.7)
    t["colorStatus" + name + "Background3"] = color
    t["colorStatus" + name + "Foreground1"] = color
    t["colorStatus" + name + "Foreground2"] = mix(color, fg, 0.3)
    t["colorStatus" + name + "Foreground3"] = color
    t["colorStatus" + name + "ForegroundInverted"] = readableOn(color, [bg, fg, "#000000", "#ffffff"])
    t["colorStatus" + name + "BorderActive"] = color
    t["colorStatus" + name + "Border1"] = mix(color, bg, 0.6)
    t["colorStatus" + name + "Border2"] = color
    if (extraDanger) {
      t.colorStatusDangerBackground3Hover = p.dark ? mix(color, "#ffffff", 0.1) : mix(color, "#000000", 0.1)
      t.colorStatusDangerBackground3Pressed = p.dark ? mix(color, "#ffffff", 0.2) : mix(color, "#000000", 0.2)
    }
  }
  status("Success", p.green)
  status("Warning", p.yellow)
  status("Danger", p.red, true)

  // --- Teams' additions on top of Fluent ------------------------------------
  // Outlook embeds Teams parts (the chat pane, meeting cards), which bring
  // these along.
  // The client declares these next to the Fluent tokens and paints some of
  // its largest surfaces with them: the content pane, the app canvas, the
  // title bar, avatars, and purple-tinted shadows around composite buttons.
  // Teams dark: Background1 #292929, Background3 #1f1f1f, Background4
  // #141414, Background5 #0a0a0a; its own tokens sit on that same ladder.
  t.colorDefaultBackground7 = mix(p.bg2, p.bg3, 0.5)   // #1a1a1a: the content canvas
  t.backgroundCanvas = p.bg3                            // #1f1f1f
  t.themeBackgroundColor = p.bg4                        // #141414
  t.themeColor = fg
  t.themeLoadingScreenColor = p.bg3                     // #1f1f1f
  t.themeCarouselTextColor = p.fg3
  t.themeTitleBarBackgroundColor = p.bg5                // #0a0a0a
  t.themeTitleBarColor = p.fg2
  t.themeTitleBarButtonColor = p.fg2
  t.themeTitleBarButtonHoverBackgroundColor = alpha(fg, 0.1)
  t.themeTitleBarButtonHoverColor = fg
  t.colorAvatar = p.brandSoft
  t.colorAvatarBackground = mix(accent, bg, 0.6)
  t.colorTeamsBrand1Hover = p.brandHover
  t.colorTeamsBrand1Pressed = p.brandPressed
  t.colorTeamsBrand1Selected = accent
  t.colorTeamsNeutralStrokeSubtleAlpha = alpha(bg, 0.5)
  for (var i = 1; i <= 4; i++) {
    t["colorTeamsButtonCompositeFocusShadow" + i] = alpha(accent, 0.08)
    t["colorTeamsButtonCompositeHoverShadow" + i] = alpha(accent, 0.05)
    t["colorTeamsCompositeActiveShadow" + i] = alpha(accent, 0.08)
    t["colorTeamsCompositeHoverShadow" + i] = alpha(accent, 0.03)
  }

  // --- Outlook's own layer ---------------------------------------------------
  // Outlook on the web still paints most of its frame with the Fluent v8
  // palette (--neutral*, --theme*, --white/--black) plus a set of its own
  // (--header*, surfaces, compose, reading pane). In its dark mode the v8
  // names are inverted -- --white is the deepest surface, --black the
  // strongest text -- which is exactly how they map from an Omarchy theme in
  // either mode: --white is the background, --black the foreground.
  var deep = p.deep
  t.white = bg
  t.black = fg
  t.neutralDark = fg
  t.neutralPrimary = fg
  t.neutralPrimaryAlt = p.fg2
  t.neutralSecondary = p.fg3
  t.neutralSecondaryAlt = p.fg3
  t.neutralTertiary = p.fg4
  t.neutralTertiaryAlt = mix(fg, bg, 0.66)
  t.neutralQuaternary = mix(fg, bg, 0.82)
  t.neutralQuaternaryAlt = mix(fg, bg, 0.84)
  t.neutralLight = mix(fg, bg, 0.8)
  t.neutralLighter = raise(bg, 0.06)
  t.neutralLighterAlt = raise(bg, 0.03)
  t.neutralPrimarySurface = bg
  t.neutralSecondarySurface = p.bg2
  t.neutralTertiarySurface = p.bg3
  t.neutralForeground4 = p.fg4
  t.neutralBackground6 = raise(bg, 0.1)
  t.neutralBackground2Pressed = p.bg2
  t.paneLighterBackground = p.bg2
  t.cardStyleWhite = p.card
  t.suiteuxNeutralLight = mix(fg, bg, 0.7)
  t.suiteuxNeutralSecondary = fg
  ;[10, 20, 40, 50].forEach(function (n) { t["blackTranslucent" + n] = alpha(fg, n / 100) })
  ;[40, 50, 65, 70, 90].forEach(function (n) { t["whiteTranslucent" + n] = alpha(bg, n / 100) })

  t.themePrimary = accent
  t.themeDarkAlt = p.brandHover
  t.themeDark = p.brandPressed
  t.themeDarker = mix(p.brandPressed, fg, 0.3)
  t.themeSecondary = mix(accent, bg, 0.12)
  t.themeTertiary = mix(accent, bg, 0.3)
  t.themeLight = mix(accent, bg, 0.62)
  t.themeLighter = mix(accent, bg, 0.76)
  t.themeLighterAlt = mix(accent, bg, 0.88)
  t.themeSecondarySurfaceSelected = mix(accent, bg, 0.76)
  t.customBrandBackground3Hover = mix(accent, bg, 0.7)
  t.customBrandBackgroundforSelected3 = mix(accent, bg, 0.76)
  t.customBrandBackground3Pressed = mix(accent, bg, 0.84)
  t.customBrandBackgroundforSelected4 = mix(accent, bg, 0.7)
  t.customBrandBackground4Hover = mix(accent, bg, 0.55)
  t.customBrandBackground4Pressed = mix(accent, bg, 0.76)
  t.headerBadgeBackground = accent
  t.headerBadgeText = p.onBrand

  // The suite header: the deepest band, like the bar above it.
  t.headerBackground = p.bg3
  t.headerBackgroundSearch = p.bg3
  t.headerBrandText = accent
  t.headerTextIcons = p.fg2
  t.headerSearchBoxBackground = raise(p.bg3, 0.08)
  t.headerSearchBoxIcon = p.fg3
  t.headerSearchPlaceholderText = p.fg3
  t.headerSearchButtonBackground = accent
  t.headerSearchButtonBackgroundHover = p.brandHover
  t.headerSearchButtonIcon = p.onBrand
  t.headerSearchFilters = accent
  t.headerSearchFiltersHover = p.brandHover
  t.headerButtonsBackground = p.bg3
  t.headerButtonsBackgroundHover = raise(p.bg3, 0.1)
  t.headerButtonsBackgroundSearch = p.bg3
  t.headerButtonsBackgroundSearchHover = raise(p.bg3, 0.1)
  t.headerSearchIcon = fg
  t.searchBoxBackground = raise(bg, 0.08)
  t.optionalHeaderBadgeHoverText = fg
  t.optionalHeaderBadgeHoverBackground = raise(p.bg3, 0.1)
  t.optionalHeaderBadgePressedText = fg
  t.optionalHeaderBadgePressedBackground = raise(p.bg3, 0.16)
  t.optionalHeaderBadgeSelectedText = fg
  t.optionalHeaderBadgeSelectedBackground = mix(accent, bg, 0.62)

  // Mail surfaces and states.
  t.composeNeutralBackground = bg
  t.readingPaneCardBorder = mix(fg, bg, 0.86)
  t.readingPaneCardFocusBorder = mix(fg, bg, 0.6)
  t.flaggedMessage = mix(p.yellow, bg, 0.86)
  t.customYellowBackground = mix(p.yellow, bg, 0.8)
  t.messageWebWarning = mix(p.yellow, bg, 0.75)
  t.customNeutralNonFocusBackground = raise(bg, 0.12)
  t.customNeutralStrokeTransparent2 = mix(fg, bg, 0.66)
  t.customNeutralStrokeOnBackground1 = mix(fg, bg, 0.4)
  t.customNeutralStrokeOnBackground1Hover = mix(fg, bg, 0.34)
  t.customNeutralStrokeOnBackground1Pressed = mix(fg, bg, 0.38)
  t.colorNeutralBackgroundInvertedTransparent4 = alpha(fg, 0.05)
  t.colorNeutralBackgroundInvertedTransparent5 = alpha(fg, 0.05)
  t.archiveBigHoverForeground = p.green
  t.archiveBigHoverBackground = mix(p.green, bg, 0.8)
  t.deleteBigHoverForeground = p.red
  t.deleteBigHoverBackground = mix(p.red, bg, 0.8)
  t.bizBarRed = mix(p.red, bg, 0.8)
  t.storageUsageBarBorder = mix(fg, bg, 0.8)
  t.calendarWorkHoursBorder = mix(fg, bg, 0.6)
  t.copilotChatBackground = bg
  t.appBackgroundGradientColor = alpha(deep(bg, 0.4), 0.5)
  t.customBlueForeground1 = accent
  t.customActiveBlueForegroundHover1 = p.brandHover
  t.communicationBlueWebPrimary = accent
  t.redDark = p.red
  t.yellow = p.yellow
  t.orange = p.orange
  t.red = p.red
  t.blue = p.blue
  t.purple = pickPurple(p)

  return t
}

// Border radii follow Hyprland's decoration:rounding so a sharp-cornered theme
// yields a sharp Outlook and a rounded one stays rounded.
function radii(rounding) {
  if (typeof rounding !== "number" || !isFinite(rounding) || rounding < 0) return {}
  var r = rounding
  function px(v) { return Math.max(0, Math.round(v)) + "px" }
  return {
    borderRadiusNone: "0",
    borderRadiusSmall: px(r * 0.35),
    borderRadiusMedium: px(r * 0.55),
    borderRadiusLarge: px(r * 0.75),
    borderRadiusXLarge: px(r),
    borderRadius2XLarge: px(r * 1.5),
    borderRadius3XLarge: px(r * 2),
    borderRadius4XLarge: px(r * 3),
    borderRadius5XLarge: px(r * 4),
    borderRadius6XLarge: px(r * 5)
  }
}

// The selector list carries every place Fluent defines its variables: the
// FluentProvider root elements (one per React tree, including portals for
// menus and dialogs) plus :root and body for anything Outlook paints outside a
// provider. `!important` beats the provider's own inline declarations.
var SELECTOR = ':root, body, .fui-FluentProvider, [class*="fui-FluentProvider"]'

// Mail content: the read message bodies and the compose editor. The sender's
// HTML decides how a message looks, so the shell font must not reach it:
// text without a font of its own would turn monospace while the rest of the
// same paragraph keeps Aptos, and a reply drafted elsewhere would show in a
// font nobody receiving it sees.
var CONTENT = '[id^="UniqueMessageBody"], [id^="editorParent"] [contenteditable="true"], [contenteditable="true"][role="textbox"][aria-multiline="true"]'
var CONTENT_FONT = 'Aptos, Calibri, "Segoe UI", Arial, Helvetica, sans-serif'

function buildCss(colors, opts) {
  opts = opts || {}
  var p = palette(colors)
  var t = tokens(p)
  var extra = radii(opts.rounding)
  for (var k in extra) t[k] = extra[k]
  if (opts.fontFamily) {
    t.fontFamilyBase = opts.fontFamily
    t.fontFamilyNumeric = opts.fontFamily
    t.fontFamilyMonospace = opts.fontFamily
  }

  var lines = ["/* omaoutlook: Omarchy theme (" + p.mode + ") */", SELECTOR + " {"]
  for (var name in t) lines.push("  --" + name + ": " + t[name] + " !important;")
  lines.push("}")
  lines.push("html, body { background-color: " + p.bg + " !important; color: " + p.fg + "; color-scheme: " + p.mode + "; }")
  if (opts.fontFamily) {
    lines.push("body { font-family: var(--fontFamilyBase) !important; }")
    lines.push(CONTENT + " { font-family: " + CONTENT_FONT + " !important; }")
  }
  lines.push("* { scrollbar-color: " + alpha(p.fg, 0.3) + " transparent; scrollbar-width: thin; }")
  lines.push("::-webkit-scrollbar { width: 8px; height: 8px; }")
  lines.push("::-webkit-scrollbar-track { background: transparent; }")
  lines.push("::-webkit-scrollbar-thumb { background: " + alpha(p.fg, 0.25) + "; border-radius: 4px; }")
  lines.push("::-webkit-scrollbar-thumb:hover { background: " + alpha(p.fg, 0.4) + "; }")
  lines.push("::selection { background: " + alpha(p.accent, 0.35) + "; }")
  // A few embedded Teams banners still use Fluent v0 (Northstar), whose colors
  // are baked into atomic classes rather than tokens.
  lines.push(".ui-alert { background-color: " + mix(p.accent, p.bg, 0.82) + " !important; color: " + p.fg + " !important; }")
  return lines.join("\n") + "\n"
}

// Where Outlook's dark mode puts message colors, and where they go instead.
//
// In dark mode Outlook rewrites every color in a message body to its own dark
// palette, inline and !important, and keeps the sender's original next to it
// (data-ogsc/data-ogac for text, data-ogsb/data-ogab for backgrounds): white
// paper becomes #292929, black text #ffffff. No stylesheet can beat an
// inline !important, so the page script moves those neutrals onto the theme's
// own ramp instead -- Outlook's paper onto the theme background, its ink onto
// the theme foreground, the grays in between proportionally. Colored text and
// fills keep Outlook's conversion. Light themes leave messages as sent.
var OWA_PAPER = 41, OWA_INK = 255

function bodyRamp(colors) {
  var p = palette(colors)
  if (!p.dark) return null
  var bg = hexToRgb(p.bg), fg = hexToRgb(p.fg)
  return { paper: OWA_PAPER, ink: OWA_INK, bg: [bg.r, bg.g, bg.b], fg: [fg.r, fg.g, fg.b] }
}

// The neutral Outlook produced, moved onto the ramp; null for colors that are
// not neutral (or not parseable) and stay as Outlook drew them. Kept as source
// text because the page script carries it into the page, and the QML engine
// cannot turn a function back into source.
var RAMP_COLOR = [
  'var m = String(value || "").match(/^rgba?\\(\\s*(\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\s*\\)$/);',
  'if (!m || !ramp) return null;',
  'var r = +m[1], g = +m[2], b = +m[3], a = m[4] === undefined ? 1 : +m[4];',
  'if (a === 0 || Math.max(r, g, b) - Math.min(r, g, b) > 12) return null;',
  'var t = ((r + g + b) / 3 - ramp.paper) / (ramp.ink - ramp.paper);',
  't = Math.max(0, Math.min(1, t));',
  'var c = [];',
  'for (var i = 0; i < 3; i++) c.push(Math.round(ramp.bg[i] + (ramp.fg[i] - ramp.bg[i]) * t));',
  'return a < 1 ? "rgba(" + c.join(", ") + ", " + a + ")" : "rgb(" + c.join(", ") + ")";'
].join("\n")
var rampColor = new Function("value", "ramp", RAMP_COLOR)

// The page-side script. Injected at document creation into every frame; it
// installs the stylesheet as early as possible, keeps converted message colors
// on the theme ramp, and exposes __omaoutlookApply so a theme switch can
// restyle the running page without a reload.
//
// `scheme` ("dark", "light" or null) pins what the page reads for
// prefers-color-scheme. Outlook set to follow the system converts message
// bodies only while that query says dark; the host asks Qt for the theme's
// scheme too, but whenever Chromium still reports light -- a page created
// before the request landed, the system flipping it back -- every message
// arrives as sent: white paper under a dark frame. Answering the query in the
// page itself makes Outlook's mode follow the Omarchy theme and nothing else.
function pageScript(css, ramp, scheme) {
  return "(function () {\n"
    + "  var css = " + JSON.stringify(css) + ";\n"
    + "  var ramp = " + JSON.stringify(ramp || null) + ";\n"
    + "  var scheme = " + JSON.stringify(scheme || null) + ";\n"
    + "  function rampColor(value, ramp) {\n" + RAMP_COLOR + "\n  }\n"
    + "  var RX = /\\(\\s*prefers-color-scheme\\s*:\\s*(dark|light)\\s*\\)/i;\n"
    + "  var queries = [];\n"
    + "  var realMatches = Object.getOwnPropertyDescriptor(MediaQueryList.prototype, 'matches').get;\n"
    + "  var realMatchMedia = window.matchMedia;\n"
    + "  function pinned(mql) { return scheme ? scheme === mql.__omaoutlookScheme : realMatches.call(mql); }\n"
    + "  window.matchMedia = function (query) {\n"
    + "    var mql = realMatchMedia.call(window, query);\n"
    + "    var m = RX.exec(String(query));\n"
    + "    if (!m || mql.__omaoutlookScheme) return mql;\n"
    + "    mql.__omaoutlookScheme = m[1].toLowerCase();\n"
    + "    Object.defineProperty(mql, 'matches', { configurable: true, get: function () { return pinned(mql); } });\n"
    // Registered before Outlook's own listeners: a system change that
    // disagrees with the pinned scheme never reaches them.
    + "    mql.addEventListener('change', function (e) { if (e.matches !== pinned(mql)) e.stopImmediatePropagation(); });\n"
    // Held weakly: Outlook may ask again on every render.
    + "    queries.push(new WeakRef(mql));\n"
    + "    return mql;\n"
    + "  };\n"
    + "  function live() {\n"
    + "    queries = queries.filter(function (r) { return r.deref(); });\n"
    + "    return queries.map(function (r) { return r.deref(); });\n"
    + "  }\n"
    + "  function announce(list, before) {\n"
    + "    for (var i = 0; i < list.length; i++) {\n"
    + "      var q = list[i];\n"
    + "      if (before[i] === q.matches) continue;\n"
    + "      try { q.dispatchEvent(new MediaQueryListEvent('change', { media: q.media, matches: q.matches })); } catch (e) {}\n"
    + "    }\n"
    + "  }\n"
    + "  function apply() {\n"
    + "    var el = document.getElementById('omaoutlook-theme');\n"
    + "    if (!el) {\n"
    + "      el = document.createElement('style');\n"
    + "      el.id = 'omaoutlook-theme';\n"
    + "      (document.head || document.documentElement).appendChild(el);\n"
    + "    }\n"
    + "    if (el.textContent !== css) el.textContent = css;\n"
    + "  }\n"
    // Outlook's own value is kept in data-omaoutlook-c/-b, so a theme switch
    // or a light theme starts from it rather than from the last rewrite.
    + "  var SEL = '[data-ogsc],[data-ogac],[data-ogsb],[data-ogab]';\n"
    + "  function move(el, prop, key) {\n"
    + "    var now = el.style.getPropertyValue(prop);\n"
    + "    var mine = el.getAttribute('data-omaoutlook-m' + key);\n"
    + "    if (now && now !== mine) el.setAttribute('data-omaoutlook-' + key, now);\n"
    + "    var owa = el.getAttribute('data-omaoutlook-' + key);\n"
    + "    if (!owa) return;\n"
    + "    var next = rampColor(owa, ramp) || owa;\n"
    + "    if (next === now) return;\n"
    + "    el.setAttribute('data-omaoutlook-m' + key, next);\n"
    + "    el.style.setProperty(prop, next, 'important');\n"
    + "    if (key === 'b' && el.hasAttribute('bgcolor')) el.setAttribute('bgcolor', next);\n"
    + "  }\n"
    // The compose editor converts the same way, but into custom properties
    // (--darkColor_rgb_255__255__255_: rgb(41, 41, 41)) set on its scroll
    // container, which the message text then uses through var().
    + "  var VARS = '[style*=\"--darkColor\"]';\n"
    + "  function json(el, name) { try { return JSON.parse(el.getAttribute(name) || '{}'); } catch (e) { return {}; } }\n"
    + "  function moveVars(el) {\n"
    + "    var owa = json(el, 'data-omaoutlook-v'), mine = json(el, 'data-omaoutlook-mv'), changed = false;\n"
    + "    for (var i = 0; i < el.style.length; i++) {\n"
    + "      var prop = el.style[i];\n"
    + "      if (prop.indexOf('--darkColor') !== 0) continue;\n"
    + "      var now = el.style.getPropertyValue(prop).trim();\n"
    + "      if (now !== mine[prop]) owa[prop] = now;\n"
    + "      var next = rampColor(owa[prop], ramp) || owa[prop];\n"
    + "      mine[prop] = next;\n"
    + "      if (next !== now) { el.style.setProperty(prop, next); changed = true; }\n"
    + "    }\n"
    + "    if (!changed) return;\n"
    + "    el.setAttribute('data-omaoutlook-v', JSON.stringify(owa));\n"
    + "    el.setAttribute('data-omaoutlook-mv', JSON.stringify(mine));\n"
    + "  }\n"
    + "  function recolor() {\n"
    + "    pending = false;\n"
    + "    var list = document.querySelectorAll(SEL);\n"
    + "    for (var i = 0; i < list.length; i++) {\n"
    + "      var el = list[i];\n"
    + "      if (el.hasAttribute('data-ogsc') || el.hasAttribute('data-ogac')) move(el, 'color', 'c');\n"
    + "      if (el.hasAttribute('data-ogsb') || el.hasAttribute('data-ogab')) move(el, 'background-color', 'b');\n"
    + "    }\n"
    + "    var hosts = document.querySelectorAll(VARS);\n"
    + "    for (var j = 0; j < hosts.length; j++) moveVars(hosts[j]);\n"
    + "  }\n"
    + "  var pending = false;\n"
    + "  function schedule() {\n"
    + "    if (pending) return;\n"
    + "    pending = true;\n"
    + "    requestAnimationFrame(recolor);\n"
    + "  }\n"
    + "  function watch() {\n"
    + "    if (window.__omaoutlookRecolor || !document.documentElement) return;\n"
    + "    window.__omaoutlookRecolor = new MutationObserver(function (records) {\n"
    + "      for (var i = 0; i < records.length; i++) {\n"
    + "        var r = records[i];\n"
    + "        if (r.type === 'childList' ? r.addedNodes.length : r.target.nodeType === 1 && (r.target.matches(SEL) || r.target.matches(VARS))) { schedule(); return; }\n"
    + "      }\n"
    + "    });\n"
    + "    window.__omaoutlookRecolor.observe(document.documentElement, {\n"
    + "      childList: true, subtree: true, attributes: true,\n"
    + "      attributeFilter: ['style', 'data-ogsc', 'data-ogac', 'data-ogsb', 'data-ogab']\n"
    + "    });\n"
    + "    schedule();\n"
    + "  }\n"
    + "  window.__omaoutlookApply = function (next, nextRamp, nextScheme) {\n"
    + "    var list = live(), before = list.map(function (q) { return q.matches; });\n"
    + "    css = String(next || '');\n"
    + "    ramp = nextRamp || null;\n"
    + "    scheme = nextScheme || null;\n"
    + "    apply();\n"
    + "    announce(list, before);\n"
    + "    schedule();\n"
    + "  };\n"
    + "  if (document.documentElement) { apply(); watch(); }\n"
    + "  document.addEventListener('DOMContentLoaded', function () { apply(); watch(); });\n"
    + "})();\n"
}
