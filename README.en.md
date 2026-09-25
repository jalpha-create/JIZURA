# JIZURA — Lyric Motion Video Maker

Turn lyrics into animated lyric videos in your browser. JIZURA combines layouts, entrances, holds, exits, decorations, text treatments, backgrounds, camera moves, effects and transitions. Change the seed or press **Create a variation** to explore another arrangement.

**[Open the English app](https://jalpha-create.github.io/JIZURA/en/)** · [日本語版](https://jalpha-create.github.io/JIZURA/) · [Japanese guide](README.md)

This jAlpha edition builds on the original [852wa/JIZURA](https://github.com/852wa/JIZURA) and the [hirazisora/JIZURA](https://github.com/hirazisora/JIZURA) fork.

The English and Japanese browser editions share the same project format and saved browser data. Use the language links at the top of the editor to switch editions without changing your lyrics or settings. English After Effects panels are available as [ScriptUI](https://jalpha-create.github.io/JIZURA/JIZURA_AE_en.jsx) and [CEP](https://jalpha-create.github.io/JIZURA/JIZURA_CEP_en.zip) downloads. The AE JSON format is the same in both languages.

## Features added in this fork

The **Foreground**, **Lyrics**, and **Background** tabs let you place uploaded images and videos above or below lyrics. Drop files into the media area, then click a file name in **Lines and cuts** to choose the file for that cut. Add a blank cut before, between, or after existing cuts; its initial file is **No image**. Automatic cut sequences still support random order and looping. Use **Tap to sync** or drag timeline boundaries to set cut times. Each media cut supports entrance, hold, exit, treatment, transition, and position and size controls. Videos can loop or use a chroma key. Foreground media can be blended with the layers below it; lyrics have their own blend mode and opacity controls. You can set a display area for each lyric line.

**Create with Jev** selects a style and line effects from your lyrics and optional natural language directions. It requires an API key and the local server included in this repository. Set `TYPESAFE_API_KEY`, then run `python jev_server.py` in the repository root. The browser sends lyrics and directions to that server; audio files stay in the browser. See the [Japanese guide](README.md) for setup details. This fork is based on [the original JIZURA](https://github.com/852wa/JIZURA).

[Jev setup guide](docs/JEV_GUIDE.en.md)

## Quick start

1. Paste lyrics into the left panel, one phrase per line. The built-in English sample is shown on a fresh install.
2. Optionally import audio. JIZURA detects beats and can snap cut boundaries to them. Use **Tap to sync** to mark the start of each line by pressing Space during playback.
3. Press **Create a variation** (or `R`) to randomize the style, mood, motion, palette and arrangement. **Previous** and **Next** navigate variations; **Change one thing** rerolls just one part.
4. Set aspect ratio, resolution and frame rate, then export MP4. Advanced mode adds a PNG sequence, transparent PNGs, color key backgrounds and individual technique controls.

**Lyrics language.** The styles are designed around Japanese fonts. For Chinese (Traditional / Simplified) and Korean lyrics, set **Lyrics language** below the lyrics box (Auto-detect is the default: kana → Japanese, Hangul → Korean, Chinese only → Traditional or Simplified by characters such as 們/们 and 說/说). Each font is then replaced with a face in that language with a similar feel — e.g. Noto Sans JP → Noto Sans TC / SC / KR, Noto Serif JP → Noto Serif TC / SC / KR, Dela Gothic One → WDXL Lubrifont TC / ZCOOL QingKe HuangYou / Black Han Sans — so a line never mixes fonts. Lyrics written almost entirely in Latin letters (English or romaji) are detected as **English** and cut into short phrases rather than single words. The AE panels have the same setting, the AE JSON carries the language, and AE falls back to the OS fonts (PingFang, Microsoft JhengHei / YaHei, Apple SD Gothic Neo, Malgun Gothic) when those faces are not installed.

**Favorites** (jAlpha edition): press ☆ to keep the current look (style, mood, arrangement seed, effects, fonts and colors) with a thumbnail, then click it to bring the look back, even for another song. Per-line settings come back only when the lyrics match. Rename or delete favorites, and save/load them as a file from the top of the Style tab.

**Brand kits** (jAlpha edition): create any number of kits (2–5 brand colors with a chosen background, fonts for the three roles, and a logo with position, size and opacity) from the Style tab. While a project uses a kit, its colors and fonts stay fixed through 1-click looks, and the logo is drawn over every cut in exports. Kits live in the browser (save/load them as a file); a project file carries a copy of its kit.

**Safe area guide** (jAlpha edition): the Safe area menu next to the play controls overlays what TikTok, Instagram Reels or YouTube Shorts cover on a 9:16 frame (approximate, measured on 1080×1920), or broadcast action/title safe for any ratio. It is preview-only and never exported.

**Batch export** (jAlpha edition) saves one MP4 per selected aspect ratio (16:9, 9:16 and 1:1 by default). Each ratio is re-arranged for its frame from the same seed, and files are named like `title_16x9.mp4`. Chrome asks once to allow multiple downloads.

A volume slider next to the play button sets the preview volume (click **Vol** to mute); exported videos keep the original level. **Transparent PNG layers** exports two transparent PNGs per frame into back/ (background graphic and decorations behind the lyrics) and front/ (lyrics, their decorations, ghosts and HUD); screen effects are applied to both, so front over back matches the normal look. Transparent PNG exports keep the background empty even when full-screen effects (invert, flash, strobe, hue shift, split screen, CRT off, black frames…) are active.

Lyric syntax: `I remember/the dawn` makes a manual cut; `*word*` emphasizes a word; a final `!` adds a flash and shake; `lyric|note` adds small annotation text; `[01:23.45]lyric` imports an LRC timestamp; `# comment` is ignored.

Use **Save** and **Open** for `.jizura.json` projects. **Export for AE** creates arrangement data to import into the After Effects panel. Generated videos and images belong to their creators; rights to music and lyrics remain with their respective rights holders. Project files, lyrics and audio are handled in the browser. Google Fonts are loaded as needed. The tool is MIT licensed; see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Build and publish

Run `python3 build.py` at the repository root. It creates `index.html` and `en/index.html`, both standalone pages for GitHub Pages. Run `python3 build_ae.py --lang en` to rebuild `JIZURA_AE_en.jsx`, and `python3 build_cep.py --lang en --out dist` to build `dist/JIZURA_CEP_en.zip` (copy the ZIP to the repository root for Pages downloads). Commit the built pages, panels and translation sources together. Publish from the repository root on GitHub Pages; the English edition is then served at `/JIZURA/en/`. Open either HTML file locally for offline use, with installed fonts as a fallback.

Install `JIZURA_AE_en.jsx` in After Effects' `Scripts/ScriptUI Panels` folder, restart AE, then open it from the Window menu. The English CEP package has a distinct extension ID, so it can coexist with the Japanese CEP panel. Extract the ZIP and use its Windows or macOS installer. These panels require After Effects to verify motion and export behavior; automated checks use a mock AE environment.
